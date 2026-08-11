import { safeParseWidgetCommand, widgetEvent, WIDGET_MAX_SESSION_MESSAGES, type WidgetCommand, type WidgetEvent, type WidgetErrorCode, type WidgetErrorClass } from "../../contracts/src/index.js";
import type { WidgetMessageEvent } from "./parentHost.js";

export type WidgetParentPort = { postMessage(message: unknown, targetOrigin: string): void };
export type WidgetBridgeController = {
  initialize(skuId: string): void;
  open(): void;
  changeSku(skuId: string): void;
  close(reason: "parent-request" | "page-hidden" | "host-destroyed"): void;
};
export type WidgetBridgeState = "waiting-init" | "ready" | "open" | "closed" | "destroyed";
export type WidgetBridgeOptions = {
  parentOrigin: string;
  parentWindow: WidgetParentPort;
  tenantId: string;
  sessionId: string;
  controller: WidgetBridgeController;
  nextRequestId(): string;
  onReject?(code: "WRONG_BINDING" | "MALFORMED" | "REPLAY" | "STALE_LIFECYCLE" | "TRANSPORT_FAILURE" | "MESSAGE_LIMIT"): void;
};

export class WidgetBridge {
  state: WidgetBridgeState = "waiting-init";
  private skuId: string | null = null;
  private readonly received = new Set<string>();
  private readonly sent = new Set<string>();
  private messageLimitExceeded = false;

  constructor(private readonly options: WidgetBridgeOptions) {
    const origin = new URL(options.parentOrigin);
    if (origin.protocol !== "https:" || origin.origin !== options.parentOrigin) throw new TypeError("parentOrigin must be an exact HTTPS origin");
  }

  receive(raw: WidgetMessageEvent): void {
    if (this.state === "destroyed" || this.messageLimitExceeded) return;
    if (raw.origin !== this.options.parentOrigin || raw.source !== this.options.parentWindow) { this.reject("WRONG_BINDING"); return; }
    const parsed = safeParseWidgetCommand(raw.data);
    if (!parsed.ok) { this.reject("MALFORMED"); return; }
    const command = parsed.value;
    if (command.tenantId !== this.options.tenantId || command.sessionId !== this.options.sessionId) { this.reject("WRONG_BINDING"); return; }
    if (this.received.has(command.requestId) || this.sent.has(command.requestId)) { this.reject("REPLAY"); return; }
    if (!this.reserveBudget(2)) return;
    this.received.add(command.requestId);
    if (!this.accept(command)) this.reject("STALE_LIFECYCLE");
  }

  cameraPermission(state: "granted" | "denied" | "unavailable"): void { this.requireOpen(); this.emitSpontaneous("jessica.cameraPermission", { state }); }
  tryOnStarted(): void { this.requireOpen(); this.emitSpontaneous("jessica.tryOnStarted", { skuId: this.skuId }); }
  captureCreated(captureRef: string): void { this.requireOpen(); this.emitSpontaneous("jessica.captureCreated", { captureRef }); }
  cartRequested(quantity = 1): void { this.requireOpen(); this.emitSpontaneous("jessica.cartRequested", { skuId: this.skuId, quantity }); }
  error(code: WidgetErrorCode, errorClass: WidgetErrorClass, recoverable: boolean, message: string): void {
    if (this.state === "closed" || this.state === "destroyed") return;
    this.emitSpontaneous("jessica.error", { code, class: errorClass, recoverable, message });
  }
  userClose(): void { this.requireOpen(); this.state = "closed"; this.emitSpontaneous("jessica.closed", { reason: "user-request" }); }
  destroy(): void { this.state = "destroyed"; this.received.clear(); this.sent.clear(); }

  private accept(command: WidgetCommand): boolean {
    if (command.type === "jessica.init" && this.state === "waiting-init") return this.execute(command, () => { this.options.controller.initialize(command.payload.skuId); this.skuId = command.payload.skuId; }, "ready", "jessica.ready", { capabilities: ["capture", "cart", "sku-change"] });
    if (command.type === "jessica.open" && this.state === "ready") return this.execute(command, () => this.options.controller.open(), "open", "jessica.opened", { skuId: this.skuId });
    if (command.type === "jessica.skuChange" && this.state === "open") return this.execute(command, () => { this.options.controller.changeSku(command.payload.skuId); this.skuId = command.payload.skuId; }, "open", "jessica.assetChanged", { skuId: command.payload.skuId });
    if (command.type === "jessica.close" && (this.state === "ready" || this.state === "open")) return this.execute(command, () => this.options.controller.close(command.payload.reason), "closed", "jessica.closed", { reason: command.payload.reason });
    return false;
  }

  private execute(command: WidgetCommand, operation: () => void, nextState: WidgetBridgeState, responseType: WidgetEvent["type"], responsePayload: unknown): true {
    try { operation(); }
    catch {
      this.state = "closed";
      this.emit("jessica.error", { code: "INTERNAL_FAILURE", class: "internal", recoverable: false, message: "Widget operation failed" }, command.requestId);
      return true;
    }
    this.state = nextState;
    this.emit(responseType, responsePayload, command.requestId);
    return true;
  }

  private requireOpen(): void { if (this.state !== "open") throw new Error("widget is not open"); }
  private emitSpontaneous(type: WidgetEvent["type"], payload: unknown): void { this.emit(type, payload, null); }
  private emit(type: WidgetEvent["type"], payload: unknown, replyTo: string | null): boolean {
    try {
      if (!this.reserveBudget(1)) return false;
      const requestId = this.options.nextRequestId();
      if (this.sent.has(requestId) || this.received.has(requestId)) throw new Error("requestId collision");
      const message = widgetEvent({ protocol: "jessica-widget", version: 1, direction: "widget-to-parent", tenantId: this.options.tenantId, sessionId: this.options.sessionId, requestId, replyTo, type, payload } as WidgetEvent);
      this.sent.add(requestId);
      this.options.parentWindow.postMessage(message, this.options.parentOrigin);
      return true;
    } catch {
      this.state = "closed";
      this.reject("TRANSPORT_FAILURE");
      return false;
    }
  }

  private reserveBudget(required: number): boolean {
    if (this.sent.size + this.received.size + required <= WIDGET_MAX_SESSION_MESSAGES) return true;
    this.messageLimitExceeded = true;
    this.state = "closed";
    this.reject("MESSAGE_LIMIT");
    return false;
  }

  private reject(code: "WRONG_BINDING" | "MALFORMED" | "REPLAY" | "STALE_LIFECYCLE" | "TRANSPORT_FAILURE" | "MESSAGE_LIMIT"): void {
    try { this.options.onReject?.(code); } catch { /* an observer cannot escape the message listener */ }
  }
}
