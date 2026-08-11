import { canonicalJson } from "../../dist/packages/contracts/src/index.js";
import { createQueuedGenerationJobEvent, replayGenerationJobLedger } from "../../dist/packages/generation-jobs/src/index.js";
import { verifyAuthoredProxyGeneratorInput } from "../../dist/packages/frame-generation/src/index.js";
import { readImmutableGenerationJobLedger, writeImmutableGenerationJobEvent } from "./generation-job-ledger-store.mjs";
import { ensurePrivateContainedDirectory, resolveLocalRoot } from "./local-contained-paths.mjs";
import { readPrivateArtifact } from "./private-capture-draft-store.mjs";

export const PRIVATE_AUTHORED_WRAPPER_MAXIMUM_BYTES = 1024 * 1024;
export const PRIVATE_GENERATION_JOB_MAXIMUM_ATTEMPTS = 10;

function eventBytes(event) { return Buffer.from(`${canonicalJson(event)}\n`); }
function appendUnproven() {
  return Object.assign(new TypeError("private queued append outcome is not exact"), { code: "EAPPENDUNPROVEN" });
}

async function exactQueuedReplay(events, queued, evaluatedAt) {
  if (events.length !== 1 || canonicalJson(events[0]) !== canonicalJson(queued)) return undefined;
  const replayed = await replayGenerationJobLedger(events, { evaluatedAt });
  if (replayed.status !== "queued" || replayed.sequence !== 1 || replayed.headEventSha256 !== queued.eventSha256) return undefined;
  return replayed;
}

function boundedPolicy(maxAttempts) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > PRIVATE_GENERATION_JOB_MAXIMUM_ATTEMPTS) {
    throw new TypeError(`maxAttempts must be between 1 and ${PRIVATE_GENERATION_JOB_MAXIMUM_ATTEMPTS}`);
  }
  return maxAttempts;
}

export async function submitPrivateProxyGenerationJob(options, operations = {}) {
  const root = await resolveLocalRoot(options.root);
  const artifact = await (operations.readArtifact ?? readPrivateArtifact)(root, options.authoredInputPath, PRIVATE_AUTHORED_WRAPPER_MAXIMUM_BYTES);
  let wrapper;
  try { wrapper = JSON.parse(artifact.bytes.toString("utf8")); }
  catch { throw Object.assign(new TypeError("private authored wrapper is not valid JSON"), { code: "EINPUTJSON" }); }
  const authored = await verifyAuthoredProxyGeneratorInput(wrapper);
  const input = authored.input;
  const request = {
    schemaVersion: 1,
    tenantId: input.candidate.tenantId,
    frameModelId: input.candidate.frameModelId,
    method: "proxy-auto",
    generator: input.generator,
    sourceAssetSha256s: input.sourceAssetHashes,
    measurementSetSha256: input.measurementSet.sha256,
    generatorInputSha256: authored.canonicalInputSha256,
    maxAttempts: boundedPolicy(options.maxAttempts),
    createdAt: options.createdAt,
  };
  const queued = await createQueuedGenerationJobEvent(request);
  const ledgerDirectory = await (operations.ensureDirectory ?? ensurePrivateContainedDirectory)(root, options.ledgerPath);
  const before = await (operations.readLedger ?? readImmutableGenerationJobLedger)(ledgerDirectory);
  if (before.length > 1 || (before.length === 1 && before[0].eventSha256 !== queued.eventSha256)) {
    throw Object.assign(new TypeError("private ledger is occupied by different evidence"), { code: "ESEQUENCECOLLISION" });
  }
  const candidate = before.length === 0 ? [queued] : before;
  const prepared = await replayGenerationJobLedger(candidate, { evaluatedAt: request.createdAt });
  if (prepared.status !== "queued" || prepared.sequence !== 1 || prepared.headEventSha256 !== queued.eventSha256) {
    throw new TypeError("private queued ledger failed exact replay");
  }
  let write;
  try {
    write = await (operations.writeEvent ?? writeImmutableGenerationJobEvent)(ledgerDirectory, queued, eventBytes(queued));
  } catch (writeError) {
    let after;
    try { after = await (operations.readLedger ?? readImmutableGenerationJobLedger)(ledgerDirectory); }
    catch { throw appendUnproven(); }
    if (after.length === 0 && before.length === 0) throw writeError;
    let replayed;
    try { replayed = await exactQueuedReplay(after, queued, request.createdAt); }
    catch { throw appendUnproven(); }
    if (!replayed) throw appendUnproven();
    return { status: "queued", existing: true, recovered: true, attempts: replayed.attempts, maxAttempts: replayed.maxAttempts };
  }
  let after;
  let replayed;
  try {
    after = await (operations.readLedger ?? readImmutableGenerationJobLedger)(ledgerDirectory);
    replayed = await exactQueuedReplay(after, queued, request.createdAt);
  } catch { throw appendUnproven(); }
  if (!replayed) throw appendUnproven();
  return { status: "queued", existing: write.existing, attempts: replayed.attempts, maxAttempts: replayed.maxAttempts };
}
