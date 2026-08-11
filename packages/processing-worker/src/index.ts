import { validateGlb } from "../../assets/src/index.js";
import { canonicalJson, sha256Hex, type GenerationJobOutputEvidence } from "../../contracts/src/index.js";
import { generateProxyBundle, PROXY_BOUND_TOLERANCE_METRES, PROXY_REQUIRED_NODES, type GeneratedProxyBundle, type ProxyGeneratorInput } from "../../frame-generation/src/index.js";
import type { GenerationJobState } from "../../generation-jobs/src/index.js";

export const PROCESSING_WORKER_FAILURE_CLASSIFICATION = Object.freeze({
  LOCAL_IO_CLEAN: { retryClassification: "retryable", condition: "No invocation-created partial output remains; immutable complete output may be exactly reused." },
  OUTPUT_RECORD_IO: { retryClassification: "retryable", condition: "The active claim remains the ledger head and verified content-addressed output is unchanged." },
  OUTPUT_COLLISION: { retryClassification: "terminal", condition: "Pre-existing output differs or only half of the expected immutable pair exists." },
  OUTPUT_VALIDATION: { retryClassification: "terminal", condition: "Actual manifest or GLB bytes are malformed, tampered, mismatched, or policy-incompatible." },
  INPUT_IDENTITY: { retryClassification: "terminal", condition: "Request, generator input, tenant, model, source, measurement, generator, config, or digest binding differs." },
  OUTPUT_CLEANUP_UNCERTAIN: { retryClassification: "terminal", condition: "Automatic retry is forbidden because removal of invocation-created invalid/partial output was not proven." },
} as const);

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertProxyAuthority(bundle: GeneratedProxyBundle): void {
  const authority = bundle.manifest.proxyGeneration;
  if (bundle.manifest.fixture !== true || authority.status !== "draft" || authority.quality !== "proxy" ||
      authority.recommendedForLive !== false || authority.admission !== "calibration-only" ||
      authority.g1 !== "active-not-ready" || authority.g2 !== "preparation-only-not-active-not-pass") {
    throw new TypeError("proxy output authority is incompatible with the local worker policy");
  }
}

function assertRequestBinding(state: GenerationJobState, input: ProxyGeneratorInput, canonicalInputSha256: string): void {
  const request = state.request;
  if (input.candidate.tenantId !== request.tenantId || input.candidate.frameModelId !== request.frameModelId) {
    throw new TypeError("proxy input tenant/model identity does not match the queued request");
  }
  if (!equal(input.generator, request.generator)) throw new TypeError("proxy input generator identity/config does not match the queued request");
  if (!equal(input.sourceAssetHashes, request.sourceAssetSha256s)) throw new TypeError("proxy input source identity does not match the queued request");
  if (input.measurementSet.sha256 !== request.measurementSetSha256) throw new TypeError("proxy input measurement identity does not match the queued request");
  if (canonicalInputSha256 !== request.generatorInputSha256) throw new TypeError("actual canonical proxy input digest does not match the queued request");
}

export async function prepareProxyAutoWork(state: GenerationJobState, value: unknown): Promise<{ input: ProxyGeneratorInput; bundle: GeneratedProxyBundle }> {
  if (state.status !== "queued") throw new TypeError("processing worker requires one queued GenerationJob");
  if (state.request.method !== "proxy-auto") throw new TypeError("processing worker accepts only method=proxy-auto");
  const bundle = await generateProxyBundle(value);
  const input = JSON.parse(bundle.canonicalInput) as ProxyGeneratorInput;
  assertRequestBinding(state, input, bundle.canonicalInputSha256);
  assertProxyAuthority(bundle);
  return { input, bundle };
}

function bytesText(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new TypeError("actual manifest bytes are not valid UTF-8"); }
}

export async function verifyActualProxyOutput(options: {
  state: GenerationJobState;
  input: ProxyGeneratorInput;
  expectedBundle: GeneratedProxyBundle;
  manifestBytes: Uint8Array;
  glbBytes: Uint8Array;
}): Promise<GenerationJobOutputEvidence> {
  const { state, input, expectedBundle, manifestBytes, glbBytes } = options;
  if (state.status !== "running" || state.request.method !== "proxy-auto") throw new TypeError("actual output verification requires a running proxy-auto claim");
  assertRequestBinding(state, input, expectedBundle.canonicalInputSha256);
  const manifestText = bytesText(manifestBytes);
  let manifest: unknown;
  try { manifest = JSON.parse(manifestText); } catch { throw new TypeError("actual manifest bytes are not valid JSON"); }
  if (!equal(manifest, expectedBundle.manifest) || manifestText !== expectedBundle.manifestJson) {
    throw new TypeError("actual manifest bytes do not match the deterministic bound manifest");
  }
  const actualManifest = manifest as GeneratedProxyBundle["manifest"];
  const actualModelSha256 = await sha256Hex(glbBytes);
  const actualManifestSha256 = await sha256Hex(manifestBytes);
  if (actualManifestSha256 !== expectedBundle.manifestSha256 || actualModelSha256 !== actualManifest.model.sha256 ||
      actualModelSha256 !== actualManifest.proxyGeneration.outputGlb.sha256) {
    throw new TypeError("actual output SHA-256 does not match manifest evidence");
  }
  if (glbBytes.byteLength !== actualManifest.model.byteLength || glbBytes.byteLength !== actualManifest.proxyGeneration.outputGlb.byteLength ||
      manifestBytes.byteLength !== new TextEncoder().encode(expectedBundle.manifestJson).byteLength) {
    throw new TypeError("actual output byte length does not match manifest evidence");
  }
  if (actualManifest.model.url !== `./${expectedBundle.glbFileName}` || actualManifest.assetId !== input.candidate.assetId ||
      actualManifest.assetVersion !== input.candidate.assetVersion || !equal(actualManifest.sourceAssetHashes, input.sourceAssetHashes) ||
      !equal(actualManifest.proxyGeneration.candidate, input.candidate) || actualManifest.proxyGeneration.measurementDigest !== input.measurementSet.sha256 ||
      actualManifest.proxyGeneration.canonicalInputSha256 !== expectedBundle.canonicalInputSha256 ||
      !equal(actualManifest.proxyGeneration.generator, input.generator) || !equal(actualManifest.proxyGeneration.sourceAssetHashes, input.sourceAssetHashes)) {
    throw new TypeError("actual manifest identity does not match the bound proxy input");
  }
  assertProxyAuthority({ ...expectedBundle, manifest: actualManifest });
  validateGlb(glbBytes, {
    requiredNodes: PROXY_REQUIRED_NODES,
    unit: "metre",
    expectedBoundsMetres: actualManifest.model.boundsMetres,
    boundsToleranceMetres: PROXY_BOUND_TOLERANCE_METRES,
  });
  return {
    manifestSha256: actualManifestSha256,
    modelSha256: actualModelSha256,
    manifestByteLength: manifestBytes.byteLength,
    modelByteLength: glbBytes.byteLength,
  };
}
