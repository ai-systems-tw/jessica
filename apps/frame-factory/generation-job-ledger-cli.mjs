#!/usr/bin/env node
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

import { canonicalJson, verifyGenerationJobEvent } from "../../dist/packages/contracts/src/index.js";
import { replayGenerationJobLedger } from "../../dist/packages/generation-jobs/src/index.js";
import { generationJobEventFileName, writeImmutableGenerationJobEvent } from "./generation-job-ledger-store.mjs";

function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function fail(code, message, status = 1) { print({ ok: false, error: { code, message }, authority: "local-evidence-only", promotable: false }); process.exitCode = status; }
function isContained(root, candidate) { const path = relative(root, candidate); return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); }
function validRelativePath(value) { return typeof value === "string" && value.length > 0 && !isAbsolute(value) && !value.split(/[\\/]/).includes("..") && !value.includes("\0"); }
async function ensureSafeDirectory(root, relativePath) {
  let current = root;
  for (const component of relativePath.split(/[\\/]/).filter((item) => item !== "" && item !== ".")) {
    current = resolve(current, component);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) { const error = new Error("unsafe output component"); error.code = "EOUTPUTCONTAINMENT"; throw error; }
  }
  return current;
}

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root"); const outputIndex = args.indexOf("--output-path"); const evaluatedIndex = args.indexOf("--evaluated-at");
if (args.length !== 7 || rootIndex < 1 || outputIndex < 1 || evaluatedIndex < 1 || rootIndex === args.length - 1 || outputIndex === args.length - 1 || evaluatedIndex === args.length - 1 || new Set([rootIndex, outputIndex, evaluatedIndex]).size !== 3) {
  fail("USAGE", "Usage: generation-job-ledger-cli.mjs <event.json> --root <existing-local-root> --output-path <relative-ledger-directory> --evaluated-at <RFC3339-UTC>", 2);
} else {
  try {
    const inputArgument = args[0]; const rootArgument = args[rootIndex + 1]; const outputArgument = args[outputIndex + 1];
    if (!validRelativePath(outputArgument)) fail("OUTPUT_PATH_INVALID", "output path must be explicit, relative, and traversal-free", 2);
    else {
      let inputText;
      try { inputText = await readFile(resolve(inputArgument), "utf8"); } catch { fail("INPUT_UNREADABLE", "event input could not be read", 2); }
      let unknownEvent;
      if (inputText !== undefined) { try { unknownEvent = JSON.parse(inputText); } catch { fail("INPUT_INVALID_JSON", "event input is not valid JSON", 2); } }
      if (unknownEvent !== undefined) {
        const event = await verifyGenerationJobEvent(unknownEvent);
        const root = await realpath(resolve(rootArgument));
        const rootInfo = await lstat(root); if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TypeError("root must resolve to a real directory");
        const requestedOutput = resolve(root, outputArgument);
        if (!isContained(root, requestedOutput)) fail("OUTPUT_CONTAINMENT", "ledger output must remain below the explicit root", 2);
        else {
          const safelyCreatedOutput = await ensureSafeDirectory(root, outputArgument);
          const output = await realpath(safelyCreatedOutput);
          if (!isContained(root, output)) fail("OUTPUT_CONTAINMENT", "ledger output resolved outside the explicit root", 2);
          else {
            const entries = await readdir(output);
            const names = [];
            for (const name of entries) {
              if (/^\.pending-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(name)) {
                try {
                  const info = await lstat(resolve(output, name));
                  if (!info.isFile() || info.isSymbolicLink()) throw new TypeError("ledger contains an invalid pending entry");
                } catch (error) {
                  if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
                }
                continue;
              }
              if (!name.endsWith(".job-event.json")) throw new TypeError("ledger contains an unknown entry");
              names.push(name);
            }
            names.sort();
            const existing = [];
            for (const name of names) {
              const path = resolve(output, name); const info = await lstat(path);
              if (!info.isFile() || info.isSymbolicLink()) throw new TypeError("ledger contains a non-regular event entry");
              const value = JSON.parse(await readFile(path, "utf8"));
              const parsed = await verifyGenerationJobEvent(value);
              if (name !== generationJobEventFileName(parsed)) throw new TypeError("ledger event filename does not bind sequence and digest");
              existing.push(parsed);
            }
            const sequenceOccupant = existing.find((item) => item.sequence === event.sequence);
            if (sequenceOccupant && sequenceOccupant.eventSha256 !== event.eventSha256) { const error = new Error("sequence collision"); error.code = "ESEQUENCECOLLISION"; throw error; }
            const candidateLedger = sequenceOccupant ? existing : [...existing, event];
            const evaluatedAt = args[evaluatedIndex + 1];
            const state = await replayGenerationJobLedger(candidateLedger, { evaluatedAt });
            const canonicalBytes = Buffer.from(`${canonicalJson(event)}\n`);
            const write = await writeImmutableGenerationJobEvent(output, event, canonicalBytes);
            print({ ok: true, evaluatedAt, jobId: state.jobId, idempotencyKey: state.idempotencyKey, event: { sequence: event.sequence, sha256: event.eventSha256, file: write.file, existing: write.existing }, state: { status: state.status, attempts: state.attempts, maxAttempts: state.maxAttempts, headEventSha256: state.headEventSha256 }, authority: "local-evidence-only", promotable: false, g1: "active-not-ready", g2: "preparation-only-not-active-not-pass", g3: "not-pass" });
          }
        }
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EOUTPUTCONTAINMENT") fail("OUTPUT_CONTAINMENT", "ledger output resolved outside the explicit root", 2);
    else if (error instanceof TypeError || error instanceof SyntaxError) fail("LEDGER_INVALID", "generation job event or ledger failed strict validation", 2);
    else if (error && typeof error === "object" && (error.code === "EEXIST" || error.code === "ESEQUENCECOLLISION")) fail("OUTPUT_COLLISION", "immutable ledger sequence collision was detected", 2);
    else fail("LEDGER_WRITE_FAILED", "local immutable ledger write failed", 2);
  }
}
