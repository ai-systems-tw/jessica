import { safeParseWidgetEvent, widgetCommand, WIDGET_MAX_SESSION_MESSAGES, type WidgetCommand, type WidgetEvent } from "../../contracts/src/index.js";

export type WidgetMessageEvent = { origin: string; source: unknown; data: unknown };
export type WidgetEventPort = {
  addMessageListener(listener: (event: WidgetMessageEvent) => void): void;
  removeMessageListener(listener: (event: WidgetMessageEvent) => void): void;
  addPageHideListener(listener: () => void): void;
  removePageHideListener(listener: () => void): void;
};
export type WidgetIframePort = {
  readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
  setSource(url: string): void;
  setSandbox(value: string): void;
  setAllow(value: string): void;
};
export type ParentWidgetHostState = "created" | "initializing" | "ready" | "opening" | "open" | "closing" | "closed" | "destroyed";

export type ParentWidgetHostOptions = {
  widgetUrl: string;
  widgetOrigin: string;
  widgetPathPrefix: string;
  tenantId: string;
  sessionId: string;
  iframe: WidgetIframePort;
  events: WidgetEventPort;
  nextRequestId(): string;
  onEvent(event: WidgetEvent): void;
  onReject?(code: "WRONG_BINDING" | "MALFORMED" | "REPLAY" | "STALE_LIFECYCLE" | "MESSAGE_LIMIT"): void;
};

type StableHostState = "created" | "ready" | "open";
type Pending = {
  type: WidgetCommand["type"];
  rollbackState: StableHostState;
  skuId?: string;
  closeReason?: "parent-request" | "page-hidden" | "host-destroyed";
};

function exactHttpsOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.origin !== raw || url.username || url.password) throw new TypeError("widgetOrigin must be an exact HTTPS origin");
  return url.origin;
}

function containedWidgetUrl(raw: string, origin: string, prefix: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.hash || url.search) throw new TypeError("widgetUrl must be an exact contained HTTPS URL without credentials, query, or fragment");
  if (!/^\/[A-Za-z0-9._~/-]*$/.test(prefix) || prefix.includes("..") || prefix.includes("//") || decodeURIComponent(url.pathname) !== url.pathname || !(url.pathname === prefix || url.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) throw new TypeError("widgetUrl escapes widgetPathPrefix");
  return url.href;
}

export class ParentWidgetHost {
  state: ParentWidgetHostState = "created";
  private readonly origin: string;
  private readonly url: string;
  private readonly pending = new Map<string, Pending>();
  private readonly sent = new Set<string>();
  private readonly received = new Set<string>();
  private target: WidgetIframePort["contentWindow"] = null;
  private skuId: string | null = null;
  private messageLimitExceeded = false;
  private readonly messageListener = (event: WidgetMessageEvent) => this.receive(event);
  private readonly pageHideListener = () => {
    if (this.state === "destroyed" || this.state === "created" || this.state === "closed") return;
    this.terminate("page-hidden", "closed");
  };

  constructor(private readonly options: ParentWidgetHostOptions) {
    this.origin = exactHttpsOrigin(options.widgetOrigin);
    this.url = containedWidgetUrl(options.widgetUrl, this.origin, options.widgetPathPrefix);
    options.iframe.setSandbox("allow-scripts allow-same-origin");
    options.iframe.setAllow(`camera ${this.origin}`);
    options.iframe.setSource(this.url);
    options.events.addMessageListener(this.messageListener);
    try { options.events.addPageHideListener(this.pageHideListener); }
    catch (error) {
      try { options.events.removePageHideListener(this.pageHideListener); } catch { /* preserve original setup failure */ }
      try { options.events.removeMessageListener(this.messageListener); } catch { /* preserve original setup failure */ }
      throw error;
    }
  }

  initialize(skuId: string): string {
    if (this.state !== "created") throw new Error("host is not created");
    this.skuId = skuId;
    this.state = "initializing";
    try { return this.send("jessica.init", { skuId }, { type: "jessica.init", rollbackState: "created" }); }
    catch (error) { if (!this.messageLimitExceeded) { this.skuId = null; this.state = "created"; } throw error; }
  }

  open(): string {
    if (this.state !== "ready") throw new Error("host is not ready");
    this.state = "opening";
    try { return this.send("jessica.open", {}, { type: "jessica.open", rollbackState: "ready" }); }
    catch (error) { if (!this.messageLimitExceeded) this.state = "ready"; throw error; }
  }

  changeSku(skuId: string): string {
    if (this.state !== "open") throw new Error("host is not open");
    if ([...this.pending.values()].some((entry) => entry.type === "jessica.skuChange")) throw new Error("SKU change is already pending");
    return this.send("jessica.skuChange", { skuId }, { type: "jessica.skuChange", rollbackState: "open", skuId });
  }

  close(): string { return this.sendClose("parent-request"); }

  destroy(): void {
    if (this.state === "destroyed") return;
    if (this.state !== "created" && this.state !== "closed") this.terminate("host-destroyed", "destroyed");
    else this.state = "destroyed";
    try { this.options.events.removeMessageListener(this.messageListener); } catch { /* terminal state is authoritative */ }
    try { this.options.events.removePageHideListener(this.pageHideListener); } catch { /* terminal state is authoritative */ }
    this.pending.clear(); this.received.clear(); this.sent.clear(); this.state = "destroyed";
  }

  private sendClose(reason: "parent-request" | "page-hidden" | "host-destroyed"): string {
    if (this.state !== "ready" && this.state !== "open") throw new Error("host cannot close in current state");
    const previous = this.state;
    this.pending.clear();
    this.state = "closing";
    try { return this.send("jessica.close", { reason }, { type: "jessica.close", rollbackState: previous, closeReason: reason }); }
    catch (error) { if (!this.messageLimitExceeded) this.state = previous; throw error; }
  }

  private send(type: WidgetCommand["type"], payload: unknown, pending: Pending): string {
    const target = this.boundTarget();
    if (!this.reserveBudget(2)) throw new Error("widget session message limit exceeded");
    const requestId = this.options.nextRequestId();
    if (this.sent.has(requestId) || this.received.has(requestId)) throw new Error("requestId collision");
    const message = widgetCommand({ protocol: "jessica-widget", version: 1, direction: "parent-to-widget", tenantId: this.options.tenantId, sessionId: this.options.sessionId, requestId, replyTo: null, type, payload } as WidgetCommand);
    this.pending.set(requestId, pending);
    this.sent.add(requestId);
    try { target.postMessage(message, this.origin); }
    catch (error) { this.pending.delete(requestId); throw error; }
    return requestId;
  }

  private receive(raw: WidgetMessageEvent): void {
    if (this.state === "destroyed" || this.messageLimitExceeded) return;
    if (raw.origin !== this.origin || this.target === null || raw.source !== this.target) { this.reject("WRONG_BINDING"); return; }
    const parsed = safeParseWidgetEvent(raw.data);
    if (!parsed.ok) { this.reject("MALFORMED"); return; }
    const event = parsed.value;
    if (event.tenantId !== this.options.tenantId || event.sessionId !== this.options.sessionId) { this.reject("WRONG_BINDING"); return; }
    if (this.received.has(event.requestId) || this.sent.has(event.requestId)) { this.reject("REPLAY"); return; }
    if (!this.reserveBudget(1)) return;
    this.received.add(event.requestId);
    if (event.replyTo !== null && !this.pending.has(event.replyTo)) { this.reject("REPLAY"); return; }
    if (!this.acceptTransition(event)) { this.reject("STALE_LIFECYCLE"); return; }
    if (event.replyTo !== null) this.pending.delete(event.replyTo);
    try { this.options.onEvent(event); } catch { /* observers cannot escape the message listener */ }
  }

  private acceptTransition(event: WidgetEvent): boolean {
    const pending = event.replyTo === null ? undefined : this.pending.get(event.replyTo);
    if (event.type === "jessica.error") {
      if (event.replyTo === null) {
        if (event.payload.recoverable) return this.state === "ready" || this.state === "open";
        if (["closed", "destroyed", "created"].includes(this.state)) return false;
        this.pending.clear(); this.state = "closed"; return true;
      }
      if (pending === undefined || !this.pendingMatchesCurrentState(pending)) return false;
      if (!event.payload.recoverable) { this.pending.clear(); this.state = "closed"; return true; }
      this.rollback(pending);
      return true;
    }
    if (event.type === "jessica.ready") { if (this.state !== "initializing" || pending?.type !== "jessica.init") return false; this.state = "ready"; return true; }
    if (event.type === "jessica.opened") { if (this.state !== "opening" || pending?.type !== "jessica.open" || event.payload.skuId !== this.skuId) return false; this.state = "open"; return true; }
    if (event.type === "jessica.assetChanged") { if (this.state !== "open" || pending?.type !== "jessica.skuChange" || event.payload.skuId !== pending.skuId) return false; this.skuId = event.payload.skuId; return true; }
    if (event.type === "jessica.closed") {
      if (this.state === "open" && event.replyTo === null && event.payload.reason === "user-request") { this.state = "closed"; return true; }
      if (this.state !== "closing" || pending?.type !== "jessica.close" || event.payload.reason !== pending.closeReason) return false;
      this.state = "closed"; return true;
    }
    if (["jessica.captureCreated", "jessica.cartRequested", "jessica.cameraPermission", "jessica.tryOnStarted"].includes(event.type)) return this.state === "open" && event.replyTo === null;
    return false;
  }

  private pendingMatchesCurrentState(pending: Pending): boolean {
    if (pending.type === "jessica.init") return this.state === "initializing";
    if (pending.type === "jessica.open") return this.state === "opening";
    if (pending.type === "jessica.skuChange") return this.state === "open";
    return this.state === "closing";
  }

  private rollback(pending: Pending): void {
    if (pending.type === "jessica.init") this.skuId = null;
    this.state = pending.rollbackState;
  }

  private boundTarget(): NonNullable<WidgetIframePort["contentWindow"]> {
    const currentTarget = this.options.iframe.contentWindow;
    if (this.target !== null && currentTarget !== this.target) throw new Error("widget contentWindow binding changed");
    const target = this.target ?? currentTarget;
    if (target === null) throw new Error("widget contentWindow is unavailable");
    this.target = target;
    return target;
  }

  private terminate(reason: "page-hidden" | "host-destroyed", terminalState: "closed" | "destroyed"): void {
    const shouldPost = this.state !== "closing" && this.state !== "created" && this.state !== "closed" && this.state !== "destroyed";
    this.pending.clear();
    this.state = terminalState;
    if (!shouldPost) return;
    try {
      const target = this.boundTarget();
      if (!this.reserveBudget(1)) return;
      const requestId = this.options.nextRequestId();
      if (this.sent.has(requestId) || this.received.has(requestId)) return;
      const message = widgetCommand({ protocol: "jessica-widget", version: 1, direction: "parent-to-widget", tenantId: this.options.tenantId, sessionId: this.options.sessionId, requestId, replyTo: null, type: "jessica.close", payload: { reason } } as WidgetCommand);
      this.sent.add(requestId);
      target.postMessage(message, this.origin);
    } catch { /* best-effort remote abort; terminal local state remains authoritative */ }
  }

  private reserveBudget(required: number): boolean {
    if (this.sent.size + this.received.size + required <= WIDGET_MAX_SESSION_MESSAGES) return true;
    this.messageLimitExceeded = true;
    this.pending.clear();
    this.state = "closed";
    this.reject("MESSAGE_LIMIT");
    return false;
  }

  private reject(code: "WRONG_BINDING" | "MALFORMED" | "REPLAY" | "STALE_LIFECYCLE" | "MESSAGE_LIMIT"): void {
    try { this.options.onReject?.(code); } catch { /* observers cannot escape the message listener */ }
  }
}
