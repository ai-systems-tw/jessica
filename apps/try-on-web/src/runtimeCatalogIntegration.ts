import {
  parseCatalogLookupRequest,
  parseCatalogUnavailableEvent,
  type CatalogLookupRequest,
  type CatalogUnavailableEvent,
  type CatalogUnavailableReasonCode,
} from "../../../packages/contracts/src/index.js";
import type { DeploymentSelection } from "../../../packages/runtime/src/index.js";
import { CatalogSelectionError, loadDeployedRuntimeAsset, type VerifiedRuntimeAsset } from "./runtimeCatalog.js";
import type { DeploymentReceiptStore, DeploymentTrustConfiguration } from "./runtimeDeployment.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CatalogUnavailableSink = {
  write(event: CatalogUnavailableEvent): void | Promise<void>;
};

export type CatalogIntegrationResult =
  | { ok: true; asset: VerifiedRuntimeAsset; fallbackApplied: boolean }
  | { ok: false; reasonCode: CatalogUnavailableReasonCode | "INVALID_REQUEST" };

export type CatalogPrefetch = {
  result: Promise<CatalogIntegrationResult>;
  cancel(): void;
};

type CachedPrefetch = {
  key: string;
  request: CatalogLookupRequest;
  controller: AbortController;
  result: Promise<CatalogIntegrationResult>;
};

export class DeployedCatalogIntegration {
  readonly #deploymentUrl: string | URL;
  readonly #selection: DeploymentSelection;
  readonly #trust: DeploymentTrustConfiguration;
  readonly #receiptStore: DeploymentReceiptStore;
  readonly #fetchFn: FetchLike | undefined;
  readonly #sink: CatalogUnavailableSink | undefined;
  readonly #nowEpochMs: () => number;
  #prefetch: CachedPrefetch | null = null;

  constructor(options: {
    deploymentUrl: string | URL;
    selection: DeploymentSelection;
    trust: DeploymentTrustConfiguration;
    receiptStore: DeploymentReceiptStore;
    fetchFn?: FetchLike;
    unavailableSink?: CatalogUnavailableSink;
    nowEpochMs?: () => number;
  }) {
    this.#deploymentUrl = options.deploymentUrl;
    this.#selection = options.selection;
    this.#trust = options.trust;
    this.#receiptStore = options.receiptStore;
    this.#fetchFn = options.fetchFn;
    this.#sink = options.unavailableSink;
    this.#nowEpochMs = options.nowEpochMs ?? Date.now;
  }

  #key(request: CatalogLookupRequest): string {
    return JSON.stringify({
      tenantId: request.tenantId,
      siteId: request.siteId,
      environment: request.environment,
      sku: request.sku,
      frameModelId: request.frameModelId,
      frameVariantId: request.frameVariantId,
      fallback: request.fallback,
    });
  }

  #emit(request: CatalogLookupRequest, reasonCode: CatalogUnavailableReasonCode): void {
    if (!this.#sink) return;
    try {
      const event = parseCatalogUnavailableEvent({
        schemaVersion: 1,
        type: "catalog.asset-unavailable",
        occurredAt: new Date(this.#nowEpochMs()).toISOString(),
        requestId: request.requestId,
        tenantId: request.tenantId,
        siteId: request.siteId,
        environment: request.environment,
        requestedSku: request.sku,
        requestedFrameModelId: request.frameModelId,
        requestedFrameVariantId: request.frameVariantId,
        fallbackKind: request.fallback.kind,
        reasonCode,
      });
      void Promise.resolve(this.#sink.write(Object.freeze(event))).catch(() => undefined);
    } catch {
      // Observability must never change the primary fail-closed result.
    }
  }

  async #perform(request: CatalogLookupRequest, signal: AbortSignal | undefined, cancellationReason: "PREFETCH_CANCELLED" | "REQUEST_CANCELLED"): Promise<CatalogIntegrationResult> {
    try {
      signal?.throwIfAborted();
      const asset = await loadDeployedRuntimeAsset({
        deploymentUrl: this.#deploymentUrl,
        selection: this.#selection,
        trust: this.#trust,
        receiptStore: this.#receiptStore,
        ...(this.#fetchFn ? { fetchFn: this.#fetchFn } : {}),
        nowEpochMs: this.#nowEpochMs(),
        catalogRequest: request,
        ...(signal ? { signal } : {}),
      });
      return { ok: true, asset, fallbackApplied: asset.catalogResolution?.fallbackApplied ?? false };
    } catch (error) {
      const reasonCode = signal?.aborted
        ? cancellationReason
        : error instanceof CatalogSelectionError
          ? error.reasonCode
          : "ASSET_CHAIN_REJECTED";
      this.#emit(request, reasonCode);
      return { ok: false, reasonCode };
    }
  }

  #awaitCached(cached: CachedPrefetch, request: CatalogLookupRequest, signal?: AbortSignal): Promise<CatalogIntegrationResult> {
    if (signal?.aborted) {
      this.#emit(request, "REQUEST_CANCELLED");
      return Promise.resolve({ ok: false, reasonCode: "REQUEST_CANCELLED" });
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: CatalogIntegrationResult): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        this.#emit(request, "REQUEST_CANCELLED");
        finish({ ok: false, reasonCode: "REQUEST_CANCELLED" });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void cached.result.then((result) => {
        if (settled) return;
        if (!result.ok && result.reasonCode !== "INVALID_REQUEST" && cached.request.requestId !== request.requestId) this.#emit(request, result.reasonCode);
        finish(result);
      });
    });
  }

  prefetchFirst(value: unknown, signal?: AbortSignal): CatalogPrefetch {
    let request: CatalogLookupRequest;
    try { request = parseCatalogLookupRequest(value); } catch {
      return { result: Promise.resolve({ ok: false, reasonCode: "INVALID_REQUEST" }), cancel() {} };
    }
    const key = this.#key(request);
    if (this.#prefetch) {
      if (this.#prefetch.key === key) {
        const existing = this.#prefetch;
        return { result: this.#awaitCached(existing, request, signal), cancel: () => existing.controller.abort() };
      }
      this.#emit(request, "PREFETCH_LIMIT_REACHED");
      return { result: Promise.resolve({ ok: false, reasonCode: "PREFETCH_LIMIT_REACHED" }), cancel() {} };
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const result = this.#perform(request, controller.signal, "PREFETCH_CANCELLED").finally(() => signal?.removeEventListener("abort", abort));
    const cached = { key, request, controller, result };
    this.#prefetch = cached;
    void result.then((outcome) => { if (!outcome.ok && this.#prefetch === cached) this.#prefetch = null; });
    return { result, cancel: () => controller.abort() };
  }

  async load(value: unknown, signal?: AbortSignal): Promise<CatalogIntegrationResult> {
    let request: CatalogLookupRequest;
    try { request = parseCatalogLookupRequest(value); } catch { return { ok: false, reasonCode: "INVALID_REQUEST" }; }
    const key = this.#key(request);
    if (this.#prefetch?.key === key) {
      const cached = this.#prefetch;
      const result = await this.#awaitCached(cached, request, signal);
      if (!result.ok && result.reasonCode === "REQUEST_CANCELLED") return result;
      if (result.ok) {
        const deadline = result.asset.deploymentFreshnessDeadlineEpochMs;
        if (deadline === undefined || this.#nowEpochMs() >= deadline) {
          if (this.#prefetch === cached) this.#prefetch = null;
          return this.#perform(request, signal, "REQUEST_CANCELLED");
        }
      }
      if (this.#prefetch === cached) this.#prefetch = null;
      return result;
    }
    if (this.#prefetch) {
      const stale = this.#prefetch;
      stale.controller.abort();
      await stale.result;
      if (this.#prefetch === stale) this.#prefetch = null;
    }
    return this.#perform(request, signal, "REQUEST_CANCELLED");
  }
}
