import {
  REVIEW_AUTHORITY_DENIALS, REVIEW_EVIDENCE_MAX_AGE_MS, REVIEW_POLICY_VERSION, REVIEW_QUEUE_MAX_BYTES,
  canonicalJson, parseReviewQueueBuildInput, parseReviewQueueCommand, reduceReviewEvidenceChain, sha256Hex, verifyReviewEvidenceEvent,
  verifyReviewWorkItem, type ReviewBinding, type ReviewEvidenceEvent, type ReviewFindingCategory,
  type ReviewOutcome, type ReviewQueueBuildInput, type ReviewQueueCommand, type ReviewQueueItem, type ReviewWorkItem,
} from "../../contracts/src/index.js";

export type ReviewReplayState = Readonly<{
  workItem: ReviewWorkItem; outcome: ReviewOutcome; severity: 0 | 1 | 2 | 3;
  reasons: readonly import("../../contracts/src/index.js").ReviewReasonCode[]; correctionAttempt: number; headEvidenceSha256: string;
  evaluatedAt: string; terminal: boolean; replayCount: number;
}>;
export type ReviewQueueBuildResult = Readonly<{ command: ReviewQueueCommand; states: readonly ReviewReplayState[]; replayCount: number }>;

function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

export async function replayReviewEvidence(workItemValue: unknown, eventValues: readonly unknown[], asOf: string): Promise<ReviewReplayState> {
  return reduceReviewEvidenceChain(workItemValue, eventValues, asOf);
}

function bindGlobalIdentity(binding: ReviewBinding, maps: { jobs: Map<string, string>; skus: Map<string, string>; variants: Map<string, string>; assets: Map<string, string> }): void {
  const entries: Array<[Map<string, string>, string, string]> = [[maps.jobs, binding.jobId, canonicalJson(binding)], [maps.skus, binding.sku, canonicalJson({ frameModelId: binding.frameModelId, frameVariantId: binding.frameVariantId })], [maps.variants, binding.frameVariantId, canonicalJson({ sku: binding.sku, frameModelId: binding.frameModelId })], [maps.assets, `${binding.assetId}:${binding.assetVersion}`, canonicalJson(binding)]]; for (const [map, identity, fingerprint] of entries) { const prior = map.get(identity); if (prior !== undefined && prior !== fingerprint) throw new TypeError("review identity is relabelled across the queue"); map.set(identity, fingerprint); }
}
function body(input: ReviewQueueBuildInput, items: readonly ReviewQueueItem[], byteLength: number, digest: string): ReviewQueueCommand {
  return { schemaVersion: 1, type: "review.queue-command", tenantId: input.tenantId, siteId: input.siteId, environment: "production", asOf: input.asOf, policyVersion: REVIEW_POLICY_VERSION, itemCount: items.length, byteLength, commandSha256: digest, idempotencyKey: `rqv1_${digest}`, operationalStatus: "local-preparation-only", g5Ready: false, authority: REVIEW_AUTHORITY_DENIALS, items };
}
export async function buildReviewQueue(value: unknown): Promise<ReviewQueueBuildResult> {
  const input = parseReviewQueueBuildInput(value); const workIds = new Map<string, string>(); const workDigests = new Map<string, ReviewWorkItem>(); const maps = { jobs: new Map<string, string>(), skus: new Map<string, string>(), variants: new Map<string, string>(), assets: new Map<string, string>() };
  for (const raw of input.workItems) { const item = await verifyReviewWorkItem(raw); if (item.binding.tenantId !== input.tenantId || item.binding.siteId !== input.siteId || item.binding.environment !== input.environment) throw new TypeError("review work item crosses queue scope"); if (Date.parse(item.createdAt) > Date.parse(input.asOf)) throw new TypeError("review work item is from the future"); const fingerprint = canonicalJson(item); const priorId = workIds.get(item.workItemId); if (priorId !== undefined) throw new TypeError(priorId === fingerprint ? "review work item is duplicated" : "review work item identity is relabelled"); if (workDigests.has(item.workItemSha256)) throw new TypeError("review work item digest is duplicated"); workIds.set(item.workItemId, fingerprint); workDigests.set(item.workItemSha256, item); bindGlobalIdentity(item.binding, maps); }
  const evidenceByWork = new Map<string, ReviewEvidenceEvent[]>(); const globalEvidenceIds = new Map<string, string>(); for (const raw of input.evidence) { const event = await verifyReviewEvidenceEvent(raw); const fingerprint = canonicalJson(event); const prior = globalEvidenceIds.get(event.eventId); if (prior !== undefined && prior !== fingerprint) throw new TypeError("review evidence identity is relabelled across the queue"); globalEvidenceIds.set(event.eventId, fingerprint); if (!workDigests.has(event.workItemSha256)) throw new TypeError("review evidence substitutes an unknown work item"); const list = evidenceByWork.get(event.workItemSha256) ?? []; list.push(event); evidenceByWork.set(event.workItemSha256, list); }
  const states: ReviewReplayState[] = []; let replayCount = 0; for (const item of workDigests.values()) { const state = await replayReviewEvidence(item, evidenceByWork.get(item.workItemSha256) ?? [], input.asOf); states.push(state); replayCount += state.replayCount; }
  states.sort((left, right) => right.severity - left.severity || left.evaluatedAt.localeCompare(right.evaluatedAt) || left.workItem.workItemId.localeCompare(right.workItem.workItemId));
  const evidenceByDigest = new Map(input.evidence.map((event) => [event.evidenceSha256, event]));
  const items = states.map((state, index): ReviewQueueItem => { const chain: ReviewEvidenceEvent[] = []; const source = evidenceByWork.get(state.workItem.workItemSha256) ?? []; for (const event of source) chain.push(evidenceByDigest.get(event.evidenceSha256)!); return Object.freeze({ position: index + 1, workItem: state.workItem, evidenceChain: Object.freeze(chain), outcome: state.outcome, severity: state.severity, reasons: state.reasons, freshness: "fresh" }); });
  const zero = "0".repeat(64); let byteLength = 1; for (let iteration = 0; iteration < 8; iteration += 1) { const next = new TextEncoder().encode(canonicalJson(body(input, items, byteLength, zero))).byteLength; if (next === byteLength) break; byteLength = next; } if (byteLength > REVIEW_QUEUE_MAX_BYTES) throw new TypeError("review queue command exceeds byte budget");
  const digest = await sha256Hex(canonicalJson(body(input, items, byteLength, zero))); const command = await parseReviewQueueCommand(body(input, items, byteLength, digest));
  return Object.freeze({ command, states: Object.freeze(states), replayCount });
}
