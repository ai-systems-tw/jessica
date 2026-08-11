#!/usr/bin/env node
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { canonicalJson } from "../../dist/packages/contracts/src/index.js";
import { authorProxyGeneratorInput } from "../../dist/packages/frame-generation/src/index.js";
import {
  PrivateArtifactStoreError,
  readPrivateArtifact,
  validPrivateArtifactPath,
  writePrivateArtifact,
} from "./private-capture-draft-store.mjs";

const ENVELOPE_MAXIMUM_BYTES = 256 * 1024;
const CAPTURE_DRAFT_MAXIMUM_BYTES = 1024 * 1024;
const ENVELOPE_KEYS = new Set(["schemaVersion", "captureDraftPath", "authoring"]);

function print(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function fail(code, message, exitCode = 1) {
  print({ ok: false, error: { code, message } });
  process.exitCode = exitCode;
}

function parseArguments(args) {
  if (args.length === 3 && !args[0].startsWith("--") && args[1] === "--output-path" && args[2].length > 0) {
    return { envelopePath: args[0], outputPath: args[2] };
  }
  return undefined;
}

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).length !== ENVELOPE_KEYS.size || Object.keys(value).some((key) => !ENVELOPE_KEYS.has(key))) return false;
  return value.schemaVersion === 1
    && validPrivateArtifactPath(value.captureDraftPath)
    && value.authoring !== null
    && typeof value.authoring === "object"
    && !Array.isArray(value.authoring);
}

async function readAtMost(handle, maximumBytes) {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1);
  let byteLength = 0;
  while (byteLength < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, byteLength, buffer.byteLength - byteLength, null);
    if (bytesRead === 0) break;
    byteLength += bytesRead;
  }
  return buffer.subarray(0, byteLength);
}

async function readBoundedEnvelope(path) {
  let handle;
  try {
    handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("not regular");
    if (before.size > ENVELOPE_MAXIMUM_BYTES) return { error: "INPUT_TOO_LARGE" };
    const bytes = await readAtMost(handle, ENVELOPE_MAXIMUM_BYTES);
    if (bytes.byteLength > ENVELOPE_MAXIMUM_BYTES) return { error: "INPUT_TOO_LARGE" };
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || bytes.byteLength !== after.size) return { error: "INPUT_CHANGED" };
    return { bytes };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { error: "INPUT_MISSING" };
    return { error: "INPUT_UNREADABLE" };
  } finally {
    if (handle) await handle.close();
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed) {
    fail("USAGE", "Usage: proxy-input-author-cli.mjs <authoring-envelope.json> --output-path <relative-private-proxy-input.json>", 2);
    return;
  }
  try {
    try { process.loadEnvFile(resolve(".env.local")); }
    catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        fail("ENV_INVALID", "local environment file could not be loaded", 2);
        return;
      }
    }
    const configuredRoot = process.env.JESSICA_PRIVATE_SOURCE_ROOT?.trim();
    if (!configuredRoot) {
      fail("ROOT_REQUIRED", "JESSICA_PRIVATE_SOURCE_ROOT is required", 2);
      return;
    }
    const envelopeRead = await readBoundedEnvelope(parsed.envelopePath);
    if (envelopeRead.error) {
      const messages = {
        INPUT_MISSING: "authoring envelope could not be read",
        INPUT_UNREADABLE: "authoring envelope must be a readable regular file",
        INPUT_TOO_LARGE: "authoring envelope exceeds the byte limit",
        INPUT_CHANGED: "authoring envelope changed while it was read",
      };
      fail(envelopeRead.error, messages[envelopeRead.error]);
      return;
    }
    let envelope;
    try { envelope = JSON.parse(envelopeRead.bytes.toString("utf8")); }
    catch { fail("INPUT_INVALID_JSON", "authoring envelope is not valid JSON"); return; }
    if (!validateEnvelope(envelope)) {
      fail("INPUT_INVALID", "authoring envelope failed strict validation");
      return;
    }
    const captureArtifact = await readPrivateArtifact(
      configuredRoot,
      envelope.captureDraftPath,
      CAPTURE_DRAFT_MAXIMUM_BYTES,
    );
    if (captureArtifact.relativePath === parsed.outputPath.split(/[\\/]/).join("/")) {
      fail("INPUT_OUTPUT_COLLISION", "capture input and authored output paths must differ", 2);
      return;
    }
    let captureDraft;
    try { captureDraft = JSON.parse(captureArtifact.bytes.toString("utf8")); }
    catch { fail("CAPTURE_DRAFT_INVALID_JSON", "private capture draft is not valid JSON"); return; }
    const authored = await authorProxyGeneratorInput(captureDraft, envelope.authoring);
    const artifact = await writePrivateArtifact(
      configuredRoot,
      parsed.outputPath,
      Buffer.from(`${canonicalJson(authored)}\n`),
    );
    print({
      ok: true,
      artifact,
      canonicalInputSha256: authored.canonicalInputSha256,
      provenance: { authority: authored.provenance.authority },
    });
  } catch (error) {
    if (error instanceof PrivateArtifactStoreError) fail(error.code, error.message, 2);
    else if (error instanceof TypeError) fail("AUTHORING_INVALID", "capture draft or proxy authoring failed strict validation");
    else fail("AUTHORING_FAILED", "proxy input authoring failed unexpectedly", 2);
  }
}

await main();
