import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import { canonicalJson } from "../../dist/packages/contracts/src/index.js";
import { appendGenerationJobEvent, replayGenerationJobLedger } from "../../dist/packages/generation-jobs/src/index.js";
import { prepareProxyAutoWork, verifyActualProxyOutput } from "../../dist/packages/processing-worker/src/index.js";
import { readImmutableGenerationJobLedger, writeImmutableGenerationJobEvent } from "./generation-job-ledger-store.mjs";
import { ensureContainedDirectory, inspectContainedPath, resolveLocalRoot } from "./local-contained-paths.mjs";
import { writeIdempotentPrivateProxyBundle, writeIdempotentProxyBundle } from "./proxy-output.mjs";

class WorkerFailure extends Error {
  constructor(code, message, retryClassification = "terminal", phase = "pre-claim", recoveryRequired = false) {
    super(message); this.name = "WorkerFailure"; this.code = code; this.retryClassification = retryClassification; this.phase = phase; this.recoveryRequired = recoveryRequired;
  }
}

function eventBytes(event) { return Buffer.from(`${canonicalJson(event)}\n`); }
function activeClaim(state, claim) {
  return state.status === "running" && state.claim?.workerId === claim.workerId && state.claim?.claimToken === claim.claimToken && state.claim?.leaseExpiresAt === claim.leaseExpiresAt;
}

function assertLiveWorkerTimeline(options) {
  const claimedAt = Date.parse(options.claimedAt);
  const outputRecordedAt = Date.parse(options.outputRecordedAt);
  const failedAt = Date.parse(options.failedAt);
  const evaluatedAt = Date.parse(options.evaluatedAt);
  const leaseExpiresAt = Date.parse(options.leaseExpiresAt);
  if (![claimedAt, outputRecordedAt, failedAt, evaluatedAt, leaseExpiresAt].every(Number.isFinite) ||
      claimedAt >= outputRecordedAt || claimedAt >= failedAt ||
      outputRecordedAt > evaluatedAt || failedAt > evaluatedAt ||
      outputRecordedAt >= leaseExpiresAt || failedAt >= leaseExpiresAt ||
      evaluatedAt >= leaseExpiresAt) {
    throw new WorkerFailure("WORKER_TIMELINE_INVALID", "explicit worker timeline is not a live synchronous claim window", "terminal", "pre-claim");
  }
}

async function readRegularBytes(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw new WorkerFailure("OUTPUT_VALIDATION", "output is not a regular file", "terminal", "post-claim");
    return new Uint8Array(await handle.readFile());
  } catch (error) {
    if (error instanceof WorkerFailure) throw error;
    if (error && typeof error === "object" && (error.code === "ELOOP" || error.code === "ENOENT")) {
      throw new WorkerFailure("OUTPUT_VALIDATION", "required actual output is missing or unsafe", "terminal", "post-claim");
    }
    throw error;
  } finally { await handle?.close(); }
}

async function cleanupCreated(paths) {
  const results = await Promise.allSettled(paths.map(async (path) => {
    try { await unlink(path); } catch (error) { if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error; }
  }));
  return results.every((result) => result.status === "fulfilled");
}

async function replayDirectory(directory, evaluatedAt) {
  const events = await readImmutableGenerationJobLedger(directory);
  return { events, state: await replayGenerationJobLedger(events, { evaluatedAt }) };
}

async function appendCas(directory, event, operations) {
  return writeImmutableGenerationJobEvent(directory, event, eventBytes(event), operations?.ledgerWrite);
}

function classify(error, phase) {
  if (error instanceof WorkerFailure) return error;
  if (error && typeof error === "object" && error.code === "EOUTPUTCONTAINMENT") return new WorkerFailure("OUTPUT_CONTAINMENT", "local output path failed containment policy", "terminal", phase);
  if (error && typeof error === "object" && error.code === "EROOTINVALID") return new WorkerFailure("ROOT_INVALID", "explicit local root failed policy", "terminal", phase);
  if (error && typeof error === "object" && error.code === "EOUTPUTCOLLISION") return new WorkerFailure("OUTPUT_COLLISION", "immutable output collision", "terminal", phase);
  if (error && typeof error === "object" && error.code === "EOUTPUTCLEANUP") return new WorkerFailure("OUTPUT_CLEANUP_UNCERTAIN", "partial output cleanup could not be proven", "terminal", phase);
  if (error instanceof TypeError || error instanceof SyntaxError) return new WorkerFailure(phase === "pre-claim" ? "INPUT_IDENTITY" : "OUTPUT_VALIDATION", "strict validation failed", "terminal", phase);
  return new WorkerFailure(phase === "pre-claim" ? "LOCAL_PREFLIGHT_IO" : "LOCAL_IO_CLEAN", "local I/O failed", "retryable", phase);
}

async function appendFailureIfOwned(context) {
  const { ledgerDirectory, evaluatedAt, failedAt, claim, operations, failure } = context;
  try {
    const current = await replayDirectory(ledgerDirectory, evaluatedAt);
    if (!activeClaim(current.state, claim)) return { recorded: false, recoveryRequired: true };
    const event = await appendGenerationJobEvent(current.state, "failed", failedAt, {
      workerId: claim.workerId,
      claimToken: claim.claimToken,
      errorCode: failure.code,
      retryClassification: failure.retryClassification,
    });
    await appendCas(ledgerDirectory, event, operations);
    const replayed = await replayDirectory(ledgerDirectory, evaluatedAt);
    if (replayed.state.status !== "failed" || replayed.state.headEventSha256 !== event.eventSha256) return { recorded: false, recoveryRequired: true };
    return { recorded: true, event, state: replayed.state, recoveryRequired: false };
  } catch {
    return { recorded: false, recoveryRequired: true };
  }
}

export async function runProxyAutoProcessingWorker(options, operations = {}) {
  let phase = "pre-claim";
  let claimAcquired = false;
  let ledgerDirectory;
  let claim;
  let createdPaths = [];
  let cleanupCreatedOutputs;
  try {
    const root = await resolveLocalRoot(options.root);
    const ledgerInspection = await inspectContainedPath(root, options.ledgerPath, { mustBeDirectory: true });
    if (!ledgerInspection.exists) throw new WorkerFailure("LEDGER_MISSING", "ledger directory does not exist");
    ledgerDirectory = ledgerInspection.path;
    await inspectContainedPath(root, options.outputPath, { mustBeDirectory: true });
    const initial = await replayDirectory(ledgerDirectory, options.evaluatedAt);
    const prepared = await prepareProxyAutoWork(initial.state, options.proxyInput);

    assertLiveWorkerTimeline(options);
    claim = { workerId: options.workerId, claimToken: options.claimToken, leaseExpiresAt: options.leaseExpiresAt };
    const claimEvent = await appendGenerationJobEvent(initial.state, "claimed", options.claimedAt, claim);
    const claimedState = await replayGenerationJobLedger([...initial.events, claimEvent], { evaluatedAt: options.evaluatedAt });
    const placeholder = { manifestSha256: "0".repeat(64), modelSha256: "1".repeat(64), manifestByteLength: 1, modelByteLength: 1 };
    const hypotheticalOutput = await appendGenerationJobEvent(claimedState, "output-recorded", options.outputRecordedAt, { workerId: options.workerId, claimToken: options.claimToken, output: placeholder });
    await replayGenerationJobLedger([...initial.events, claimEvent, hypotheticalOutput], { evaluatedAt: options.evaluatedAt });
    const hypotheticalFailure = await appendGenerationJobEvent(claimedState, "failed", options.failedAt, { workerId: options.workerId, claimToken: options.claimToken, errorCode: "LOCAL_IO_CLEAN", retryClassification: "retryable" });
    await replayGenerationJobLedger([...initial.events, claimEvent, hypotheticalFailure], { evaluatedAt: options.evaluatedAt });

    let afterClaim;
    try { await appendCas(ledgerDirectory, claimEvent, operations); }
    catch (error) {
      const current = await replayDirectory(ledgerDirectory, options.evaluatedAt).catch(() => null);
      if (!current) throw new WorkerFailure("CLAIM_COMMIT_UNPROVEN", "claim append outcome could not be proven from the ledger", "terminal", "pre-claim", true);
      if (current.state.headEventSha256 === claimEvent.eventSha256 && activeClaim(current.state, claim)) afterClaim = current;
      else if (current.state.headEventSha256 !== initial.state.headEventSha256 || error && typeof error === "object" && error.code === "EEXIST") {
        throw new WorkerFailure("CLAIM_CONTENTION", "another claimant won the immutable sequence slot", "retryable");
      } else {
        throw new WorkerFailure("CLAIM_APPEND_IO", "claim was not published and local append failed", "retryable");
      }
    }
    afterClaim ??= await replayDirectory(ledgerDirectory, options.evaluatedAt);
    if (!activeClaim(afterClaim.state, claim) || afterClaim.state.headEventSha256 !== claimEvent.eventSha256) throw new WorkerFailure("CLAIM_CONTENTION", "claim is not the active ledger head", "retryable");
    claimAcquired = true; phase = "post-claim";

    const outputDirectory = await ensureContainedDirectory(root, options.outputPath);
    const glbPath = join(outputDirectory, prepared.bundle.glbFileName);
    const manifestPath = join(outputDirectory, prepared.bundle.manifestFileName);
    if (basename(glbPath) !== prepared.bundle.glbFileName || basename(manifestPath) !== prepared.bundle.manifestFileName) throw new WorkerFailure("OUTPUT_CONTAINMENT", "generated name escaped output directory", "terminal", phase);
    const bundleOptions = { glbPath, manifestPath, glb: prepared.bundle.glb, manifestJson: prepared.bundle.manifestJson };
    const write = options.privatePublication === true
      ? await writeIdempotentPrivateProxyBundle(bundleOptions, operations.bundleWrite)
      : await writeIdempotentProxyBundle(bundleOptions, operations.bundleWrite);
    createdPaths = write.createdPaths;
    cleanupCreatedOutputs = write.cleanupCreated;
    if (operations.afterWrite) await operations.afterWrite({ glbPath, manifestPath, existing: write.existing });
    const manifestBytes = await readRegularBytes(manifestPath);
    const glbBytes = await readRegularBytes(glbPath);
    const evidence = await verifyActualProxyOutput({ state: afterClaim.state, input: prepared.input, expectedBundle: prepared.bundle, manifestBytes, glbBytes });
    const outputEvent = await appendGenerationJobEvent(afterClaim.state, "output-recorded", options.outputRecordedAt, { workerId: options.workerId, claimToken: options.claimToken, output: evidence });
    try { await appendCas(ledgerDirectory, outputEvent, operations); }
    catch (error) {
      const current = await replayDirectory(ledgerDirectory, options.evaluatedAt).catch(() => null);
      if (!current || current.state.headEventSha256 !== outputEvent.eventSha256) throw new WorkerFailure("OUTPUT_RECORD_IO", "verified output could not be recorded under the active claim", "retryable", phase);
    }
    const final = await replayDirectory(ledgerDirectory, options.evaluatedAt);
    if (final.state.status !== "review" || final.state.headEventSha256 !== outputEvent.eventSha256) throw new WorkerFailure("OUTPUT_RECORD_IO", "ledger did not reach exact review state", "retryable", phase);
    return {
      ok: true,
      jobId: final.state.jobId,
      state: { status: "review", attempts: final.state.attempts, headEventSha256: final.state.headEventSha256 },
      output: { manifest: prepared.bundle.manifestFileName, model: prepared.bundle.glbFileName, evidence, existing: write.existing },
      authority: { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false },
      g1: "active-not-ready", g2: "preparation-only-not-active-not-pass", g3: "not-pass",
    };
  } catch (rawError) {
    let failure = classify(rawError, phase);
    if (claimAcquired && failure.code === "OUTPUT_VALIDATION" && createdPaths.length > 0) {
      const cleaned = cleanupCreatedOutputs ? await cleanupCreatedOutputs() : await cleanupCreated(createdPaths);
      if (!cleaned) failure = new WorkerFailure("OUTPUT_CLEANUP_UNCERTAIN", "invalid output cleanup could not be proven", "terminal", phase);
    }
    let failed = { recorded: false, recoveryRequired: failure.recoveryRequired === true };
    if (claimAcquired && ledgerDirectory && claim) failed = await appendFailureIfOwned({ ledgerDirectory, evaluatedAt: options.evaluatedAt, failedAt: options.failedAt, claim, operations, failure });
    return {
      ok: false,
      error: { code: failure.code, message: failure.message, retryClassification: failure.retryClassification },
      failedEventRecorded: failed.recorded,
      recoveryRequired: failed.recoveryRequired,
      authority: { fixture: true, status: "draft", quality: "proxy", recommendedForLive: false, admission: "calibration-only", promotable: false },
      g1: "active-not-ready", g2: "preparation-only-not-active-not-pass", g3: "not-pass",
    };
  }
}
