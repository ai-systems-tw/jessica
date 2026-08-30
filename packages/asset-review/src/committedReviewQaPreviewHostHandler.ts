/** HTTP-framework-neutral one-POST host boundary for JSC-0221A2. */
import { parseUnverifiedCommittedReviewQaPreviewBundleContainer } from "../../assets/src/index.js";
import { parseCommittedReviewQaPreviewTransportRequest } from "../../contracts/src/index.js";
import type { CommittedReviewQaPreviewTransportIssuer, CommittedReviewQaPreviewTransportVerifier } from "./committedReviewQaPreviewTransport.js";

export const COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_CONTENT_TYPE = "application/vnd.jessica.qa-preview-runtime-bundle.v1" as const;

export type CommittedReviewQaPreviewHostResponse = Readonly<{
  status: 200;
  headers: Readonly<{
    "Content-Type": typeof COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_CONTENT_TYPE;
    "Content-Length": string;
    "X-Content-Type-Options": "nosniff";
    "Cache-Control": "private, no-store";
    "Referrer-Policy": "no-referrer";
    "Content-Disposition": "inline";
    "Cross-Origin-Resource-Policy": "same-origin";
  }>;
  body: Uint8Array<ArrayBuffer>;
}>;

export class CommittedReviewQaPreviewHostError {
  readonly code: "UNAVAILABLE" | "CANCELLED";
  constructor(code: "UNAVAILABLE" | "CANCELLED") { this.code = code; Object.freeze(this); }
}

export type CommittedReviewQaPreviewHostHandler = Readonly<{
  /** Authentication/session/CSRF identity is separate trusted request context. */
  handle(actorRequestIdentity: unknown, requestBody: unknown, signal?: AbortSignal): Promise<CommittedReviewQaPreviewHostResponse>;
}>;

export type CommittedReviewQaPreviewHostHandlerDependencies = Readonly<{
  issuer: CommittedReviewQaPreviewTransportIssuer;
  verifier: CommittedReviewQaPreviewTransportVerifier<Uint8Array<ArrayBuffer>>;
  maximumOperationAgeMs?: number;
  /** Injectable monotonic clock for deterministic deadline acceptance tests. */
  monotonicNow?: () => number;
}>;

const abortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const uint8Slice = Uint8Array.prototype.slice;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;

function cancelled(signal?: AbortSignal): void {
  if (signal === undefined) return;
  if (!abortSignalAborted || typeof signal !== "object" || signal === null) throw new CommittedReviewQaPreviewHostError("CANCELLED");
  let value: unknown; try { value = Reflect.apply(abortSignalAborted, signal, []); } catch { throw new CommittedReviewQaPreviewHostError("CANCELLED"); }
  if (value !== false) throw new CommittedReviewQaPreviewHostError("CANCELLED");
}
function snapshot(value: unknown): Uint8Array<ArrayBuffer> {
  try {
    if (!(value instanceof Uint8Array) || !typedArrayBuffer || !typedArrayByteOffset || !typedArrayByteLength) throw new Error();
    const length = Reflect.apply(typedArrayByteLength, value, []) as number; const buffer = Reflect.apply(typedArrayBuffer, value, []); const offset = Reflect.apply(typedArrayByteOffset, value, []) as number;
    if (!(buffer instanceof ArrayBuffer) || length < 1) throw new Error();
    const copy = Reflect.apply(uint8Slice, new Uint8Array(buffer, offset, length), []) as Uint8Array<ArrayBuffer>;
    parseUnverifiedCommittedReviewQaPreviewBundleContainer(copy);
    return copy;
  } catch { throw new CommittedReviewQaPreviewHostError("UNAVAILABLE"); }
}

export function createCommittedReviewQaPreviewHostHandler(dependencies: CommittedReviewQaPreviewHostHandlerDependencies): CommittedReviewQaPreviewHostHandler {
  if (typeof dependencies?.issuer?.issue !== "function" || typeof dependencies?.verifier?.consume !== "function") throw new TypeError("invalid QA-preview host dependencies");
  const maximumOperationAgeMs = dependencies.maximumOperationAgeMs ?? 30_000;
  if (!Number.isSafeInteger(maximumOperationAgeMs) || maximumOperationAgeMs < 1 || maximumOperationAgeMs > 120_000) throw new TypeError("invalid QA-preview host operation age");
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  if (typeof monotonicNow !== "function") throw new TypeError("invalid QA-preview host monotonic clock");
  return Object.freeze({
    async handle(actorRequestIdentity: unknown, requestBody: unknown, signal?: AbortSignal): Promise<CommittedReviewQaPreviewHostResponse> {
      cancelled(signal);
      let startedAt: number; try { startedAt = monotonicNow(); } catch { throw new CommittedReviewQaPreviewHostError("UNAVAILABLE"); }
      if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt < 0) throw new CommittedReviewQaPreviewHostError("UNAVAILABLE");
      const deadline = startedAt + maximumOperationAgeMs;
      if (!Number.isFinite(deadline) || deadline <= startedAt) throw new CommittedReviewQaPreviewHostError("UNAVAILABLE");
      const controller = new AbortController(); let rejectBoundary: ((error: CommittedReviewQaPreviewHostError) => void) | undefined; let settled = false;
      const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
      const trip = (code: "UNAVAILABLE" | "CANCELLED"): void => {
        if (settled) return;
        try { controller.abort(); } catch { /* trusted controller best effort */ }
        rejectBoundary?.(new CommittedReviewQaPreviewHostError(code));
      };
      const checkDeadline = (): void => {
        cancelled(controller.signal);
        let observed: number; try { observed = monotonicNow(); } catch { throw new CommittedReviewQaPreviewHostError("UNAVAILABLE"); }
        if (typeof observed !== "number" || !Number.isFinite(observed) || observed < startedAt || observed >= deadline) { trip("UNAVAILABLE"); throw new CommittedReviewQaPreviewHostError("UNAVAILABLE"); }
      };
      const onAbort = (): void => trip("CANCELLED"); const timer = setTimeout(() => trip("UNAVAILABLE"), maximumOperationAgeMs);
      try { const timerObject = timer as unknown as { unref?: () => void }; if (typeof timerObject.unref === "function") timerObject.unref(); } catch { /* browser timer */ }
      let listening = false;
      try {
        if (signal !== undefined) { Reflect.apply(eventTargetAddEventListener, signal, ["abort", onAbort, { once: true }]); listening = true; cancelled(signal); }
        const operation = (async (): Promise<CommittedReviewQaPreviewHostResponse> => {
          let request: ReturnType<typeof parseCommittedReviewQaPreviewTransportRequest>;
          try { request = parseCommittedReviewQaPreviewTransportRequest(requestBody); } catch { throw new CommittedReviewQaPreviewHostError("UNAVAILABLE"); }
          try {
            // Exactly one issue and one consume. There is deliberately no retry path.
            const grant = await dependencies.issuer.issue(actorRequestIdentity, request, controller.signal); checkDeadline();
            const runtimeResult = await dependencies.verifier.consume(actorRequestIdentity, grant, controller.signal); checkDeadline();
            const body = snapshot(runtimeResult); checkDeadline();
            return Object.freeze({ status: 200 as const, headers: Object.freeze({
              "Content-Type": COMMITTED_REVIEW_QA_PREVIEW_BUNDLE_CONTENT_TYPE,
              "Content-Length": String(body.byteLength),
              "X-Content-Type-Options": "nosniff" as const,
              "Cache-Control": "private, no-store" as const,
              "Referrer-Policy": "no-referrer" as const,
              "Content-Disposition": "inline" as const,
              "Cross-Origin-Resource-Policy": "same-origin" as const,
            }), body });
          } catch { if (signal !== undefined) cancelled(signal); throw new CommittedReviewQaPreviewHostError("UNAVAILABLE"); }
        })();
        return await Promise.race([operation, boundary]);
      } finally {
        settled = true; clearTimeout(timer);
        if (listening && signal !== undefined) { try { Reflect.apply(eventTargetRemoveEventListener, signal, ["abort", onAbort]); } catch { /* best effort */ } }
      }
    },
  });
}
