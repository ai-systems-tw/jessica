import {
  FORMALIZATION_ARTIFACT_KINDS,
  FORMALIZATION_PHYSICAL_FIELDS,
  FORMALIZATION_SCOPES,
  FORMALIZATION_TOTAL_ARTIFACT_MAX_BYTES,
  attestationPayload,
  formalizationCandidateSha256,
  parseActualByteArtifact,
  parseFormalizationCandidate,
  parseSignedEvidenceAttestation,
  parseVerifiedPhysicalMeasurementDocument,
  type ActualByteArtifact,
  type FormalizationCandidate,
  type FormalizationScope,
  type FormalizationTrustConfiguration,
  type SignedArtifactDescriptor,
  type SignedEvidenceAttestation,
} from "../../contracts/src/nonProxyFormalizationReadiness.js";
import { canonicalJson, sha256Hex } from "../../contracts/src/generationJob.js";
import { parseAssetManifest } from "../../contracts/src/catalog.js";
import { verifyNonProxyQaDecisionEvidence } from "../../contracts/src/nonProxyQaReview.js";
import { validateGlb } from "../../assets/src/index.js";
import { reviewNonProxyGenerationOutput } from "./nonProxy.js";

export const FORMALIZATION_AUTHORITY_DENIAL = Object.freeze({
  qaApproved: false,
  assetVersionCreated: false,
  assetVersionPromoted: false,
  recommendedForLive: false,
  activeDeployment: false,
  publication: false,
  gates: false,
} as const);

export type FormalizationReadinessResult = Readonly<{
  readiness: "evidence-package-verified-for-authorized-human-review-input";
  candidateSha256: string;
  attestedScopes: readonly FormalizationScope[];
  artifactDigestIntegrityVerified: true;
  structuredModelAndMeasurementValidated: true;
  signaturesVerified: true;
  evaluatedAt: string;
  validUntil: string;
  attestationPayloadSha256s: readonly string[];
  authority: typeof FORMALIZATION_AUTHORITY_DENIAL;
}>;

const REQUEST_KEYS = ["candidate", "artifacts", "attestations"] as const;
const CONTEXT_KEYS = ["evaluatedAt", "trust"] as const;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const REQUIREMENT_BY_SCOPE = {
  "physical-measurement": "physical",
  "visual-fidelity": "visualFidelity",
  "actual-wear-consent": "actualWear",
  "rights-clearance": "rights",
} as const;

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path} must not contain symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} fields must be enumerable data properties`);
  }
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).find((key) => !expected.has(key));
  const missing = keys.find((key) => !(key in value));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function array(value: unknown, path: string, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length) throw new TypeError(`${path} must be a bounded dense plain array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path} items must be enumerable data properties`);
  }
}

function identifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`);
}

function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value);
  const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`);
}

function parseTrust(value: unknown): FormalizationTrustConfiguration {
  object(value, "trust");
  exact(value, ["trustedKeys", "maximumAttestationLifetimeMs"], "trust");
  if (typeof value.maximumAttestationLifetimeMs !== "number" || !Number.isSafeInteger(value.maximumAttestationLifetimeMs) || value.maximumAttestationLifetimeMs < 1 || value.maximumAttestationLifetimeMs > 31 * 24 * 60 * 60 * 1000) throw new TypeError("trust.maximumAttestationLifetimeMs is invalid");
  object(value.trustedKeys, "trust.trustedKeys");
  const entries = Object.entries(value.trustedKeys);
  if (entries.length === 0 || entries.length > 16) throw new TypeError("trust.trustedKeys must contain 1 to 16 keys");
  const trustedKeys: Record<string, FormalizationTrustConfiguration["trustedKeys"][string]> = {};
  const publicKeyFingerprints = new Set<string>();
  for (const [keyId, raw] of entries) {
    identifier(keyId, "trust keyId");
    object(raw, `trust.trustedKeys.${keyId}`);
    exact(raw, ["authorityId", "tenantId", "scopes", "publicJwk"], `trust.trustedKeys.${keyId}`);
    identifier(raw.authorityId, `trust.trustedKeys.${keyId}.authorityId`);
    identifier(raw.tenantId, `trust.trustedKeys.${keyId}.tenantId`);
    array(raw.scopes, `trust.trustedKeys.${keyId}.scopes`, FORMALIZATION_SCOPES.length);
    if (raw.scopes.length === 0 || raw.scopes.some((scope) => !FORMALIZATION_SCOPES.includes(scope as FormalizationScope)) || new Set(raw.scopes).size !== raw.scopes.length || canonicalJson(raw.scopes) !== canonicalJson([...raw.scopes].sort())) throw new TypeError("trusted key scopes must be non-empty, unique, supported, and sorted");
    object(raw.publicJwk, `trust.trustedKeys.${keyId}.publicJwk`);
    exact(raw.publicJwk, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"], `trust.trustedKeys.${keyId}.publicJwk`);
    array(raw.publicJwk.key_ops, `trust.trustedKeys.${keyId}.publicJwk.key_ops`, 1);
    if (raw.publicJwk.key_ops.length !== 1 || raw.publicJwk.key_ops[0] !== "verify" || raw.publicJwk.ext !== true || raw.publicJwk.kty !== "EC" || raw.publicJwk.crv !== "P-256" || raw.publicJwk.use !== "sig" || raw.publicJwk.alg !== "ES256" || typeof raw.publicJwk.x !== "string" || typeof raw.publicJwk.y !== "string" || raw.publicJwk.x.length !== 43 || raw.publicJwk.y.length !== 43) throw new TypeError("trusted JWK must be an ES256 public P-256 signature-verification key");
    const fingerprint = `${raw.publicJwk.crv}:${raw.publicJwk.x}:${raw.publicJwk.y}`;
    if (publicKeyFingerprints.has(fingerprint)) throw new TypeError("trusted formalization authorities must use independent public keys");
    publicKeyFingerprints.add(fingerprint);
    trustedKeys[keyId] = { authorityId: raw.authorityId, tenantId: raw.tenantId, scopes: [...raw.scopes] as FormalizationScope[], publicJwk: structuredClone(raw.publicJwk) };
  }
  return { trustedKeys, maximumAttestationLifetimeMs: value.maximumAttestationLifetimeMs };
}

function descriptor(artifact: ActualByteArtifact): SignedArtifactDescriptor {
  const { bytes: _ignored, ...value } = artifact;
  return value;
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function requiredArtifactsForScope(scope: FormalizationScope, byKind: Map<string, ActualByteArtifact[]>): ActualByteArtifact[] {
  const sources = byKind.get("source") ?? [];
  const one = (kind: string): ActualByteArtifact => {
    const values = byKind.get(kind) ?? [];
    if (values.length !== 1) throw new TypeError(`formalization requires exactly one ${kind} artifact`);
    return values[0]!;
  };
  const provenance = [one("generation-ledger"), one("qa-decision")];
  if (scope === "physical-measurement") return [...sources, ...provenance, one("measurement-sheet")];
  if (scope === "visual-fidelity") return [...sources, ...provenance, one("visual-capture"), one("model"), one("manifest")];
  if (scope === "actual-wear-consent") return [...sources, ...provenance, one("actual-wear-capture")];
  return [...sources, ...provenance, one("rights-record")];
}

function assertClaimBindsArtifacts(attestation: SignedEvidenceAttestation, artifacts: Map<string, ActualByteArtifact>, candidate: FormalizationCandidate): void {
  const requirement = candidate.requirements[REQUIREMENT_BY_SCOPE[attestation.scope]];
  const source = [...artifacts.values()].find((artifact) => artifact.kind === "source" && artifact.sha256 === requirement.sourceAssetSha256);
  if (!source) throw new TypeError(`${attestation.scope} requirement source is not present as actual bytes`);
  if (attestation.scope === "physical-measurement") {
    const claim = attestation.claim;
    if (claim.kind !== "physical") throw new TypeError("physical scope claim is inconsistent");
    const measurementArtifact = artifacts.get(claim.measurementArtifactId);
    if (!measurementArtifact || measurementArtifact.kind !== "measurement-sheet" || measurementArtifact.sha256 !== requirement.evidenceSha256 || measurementArtifact.sha256 !== requirement.measurementSetSha256) throw new TypeError("physical evidence and MeasurementSet digests must identify the same actual measurement artifact");
    for (const [index, measurement] of claim.measurements.entries()) {
      if (measurement.field !== FORMALIZATION_PHYSICAL_FIELDS[index]) throw new TypeError("physical measurement order is inconsistent");
      const measurementSource = artifacts.get(measurement.sourceArtifactId);
      if (!measurementSource || measurementSource.kind !== "source") throw new TypeError("physical measurement must bind an actual source artifact");
      if (measurementSource.artifactId !== source.artifactId) throw new TypeError("physical measurements must bind the candidate physical requirement source");
      if (measurement.method !== "caliper") throw new TypeError("formalization currently requires verified caliper evidence");
    }
    return;
  }
  const mapping = {
    "visual-fidelity": ["visual", "visualArtifactId", "visual-capture"],
    "actual-wear-consent": ["actual-wear", "actualWearArtifactId", "actual-wear-capture"],
    "rights-clearance": ["rights", "rightsArtifactId", "rights-record"],
  } as const;
  const [claimKind, key, artifactKind] = mapping[attestation.scope];
  if (attestation.claim.kind !== claimKind) throw new TypeError("attestation claim is inconsistent with scope");
  const artifactId = (attestation.claim as unknown as Record<string, unknown>)[key];
  const evidence = typeof artifactId === "string" ? artifacts.get(artifactId) : undefined;
  if (!evidence || evidence.kind !== artifactKind || evidence.sha256 !== requirement.evidenceSha256) throw new TypeError(`${attestation.scope} evidence digest must identify the claimed actual artifact`);
}

function decodeCanonicalJson(artifact: ActualByteArtifact, label: string): unknown {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes); }
  catch { throw new TypeError(`${label} must be valid UTF-8 JSON`); }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new TypeError(`${label} must be valid JSON`); }
  if (canonicalJson(parsed) !== text) throw new TypeError(`${label} bytes must be canonical JSON`);
  return parsed;
}

export function validateNonProxyAssetProvenance(manifest: import("../../contracts/src/catalog.js").AssetManifest, glbJson: Record<string, unknown>, candidate: FormalizationCandidate): void {
  if ("proxyGeneration" in (manifest as unknown as Record<string, unknown>)) throw new TypeError("non-Proxy formalization rejects proxyGeneration manifest provenance");
  const asset = glbJson.asset;
  if (typeof asset !== "object" || asset === null || Array.isArray(asset)) throw new TypeError("GLB asset metadata is required");
  const assetRecord = asset as Record<string, unknown>;
  if (assetRecord.generator !== `${candidate.generation.generator.id}@${candidate.generation.generator.version}`) throw new TypeError("GLB generator provenance does not match the non-Proxy candidate");
  const assetExtras = typeof assetRecord.extras === "object" && assetRecord.extras !== null && !Array.isArray(assetRecord.extras) ? assetRecord.extras as Record<string, unknown> : {};
  const rootExtras = typeof glbJson.extras === "object" && glbJson.extras !== null && !Array.isArray(glbJson.extras) ? glbJson.extras as Record<string, unknown> : {};
  if (assetExtras.profile === "explicit-manual-2d-proxy" || rootExtras.quality === "proxy" || ("fixture" in rootExtras && rootExtras.fixture !== false)) throw new TypeError("GLB contains calibration-only Proxy or fixture provenance");
  const nodes = Array.isArray(glbJson.nodes) ? glbJson.nodes : [];
  if (nodes.some((node) => typeof node === "object" && node !== null && typeof (node as Record<string, unknown>).name === "string" && /PROXY_NOT_PRODUCT|SYNTHETIC_PROXY/.test((node as Record<string, unknown>).name as string))) throw new TypeError("GLB contains a calibration-only Proxy marker");
}

async function assertStructuredEvidence(byKind: Map<string, ActualByteArtifact[]>, candidate: FormalizationCandidate, attestations: readonly SignedEvidenceAttestation[], hostEvaluatedAt: string): Promise<void> {
  const measurementArtifact = byKind.get("measurement-sheet")![0]!;
  const measurement = parseVerifiedPhysicalMeasurementDocument(decodeCanonicalJson(measurementArtifact, "measurement document"));
  const physical = attestations.find((attestation) => attestation.scope === "physical-measurement");
  if (!physical || physical.claim.kind !== "physical") throw new TypeError("physical attestation is required");
  if (measurementArtifact.sha256 !== candidate.requirements.physical.measurementSetSha256 || measurementArtifact.sha256 !== candidate.requirements.physical.evidenceSha256) throw new TypeError("measurement document bytes must equal the candidate MeasurementSet and physical evidence digests");
  if (measurement.tenantId !== candidate.tenantId || measurement.frameModelId !== candidate.frameModelId || measurement.frameVariantId !== candidate.frameVariantId || measurement.verifiedByAuthorityId !== physical.authorityId) throw new TypeError("measurement document identity or verifying authority does not match the candidate and attestation");
  if (Date.parse(measurement.measuredAt) > Date.parse(physical.issuedAt)) throw new TypeError("physical attestation cannot predate the verified measurement document");
  const expectedSource = candidate.requirements.physical.sourceAssetSha256;
  for (const [index, item] of measurement.measurements.entries()) {
    const claim = physical.claim.measurements[index]!;
    if (item.field !== claim.field || item.valueMm !== claim.valueMm || item.method !== claim.method || item.sourceSha256 !== expectedSource) throw new TypeError("signed physical claim must exactly match the verified measurement document and physical source");
  }

  const manifestArtifact = byKind.get("manifest")![0]!;
  const modelArtifact = byKind.get("model")![0]!;
  const manifest = parseAssetManifest(decodeCanonicalJson(manifestArtifact, "asset manifest"));
  if (manifest.fixture !== false || manifest.assetId !== candidate.id || manifest.assetVersion !== candidate.version) throw new TypeError("asset manifest must identify the non-fixture candidate version");
  if (manifest.generator.name !== candidate.generation.generator.id || manifest.generator.version !== candidate.generation.generator.version) throw new TypeError("asset manifest generator does not match the candidate");
  if (manifest.model.url !== candidate.modelUrl || manifest.model.sha256 !== candidate.modelSha256 || manifest.model.byteLength !== candidate.modelByteLength) throw new TypeError("asset manifest model does not match the candidate and actual model bytes");
  if (!same([...manifest.sourceAssetHashes].sort(), candidate.sourceAssetHashes)) throw new TypeError("asset manifest source set does not match the candidate");
  const validatedGlb = validateGlb(modelArtifact.bytes, { requiredNodes: manifest.model.requiredNodes, unit: manifest.model.unit, expectedBoundsMetres: manifest.model.boundsMetres });
  validateNonProxyAssetProvenance(manifest, validatedGlb.json, candidate);

  const ledger = decodeCanonicalJson(byKind.get("generation-ledger")![0]!, "GenerationJob ledger");
  const decisionValue = decodeCanonicalJson(byKind.get("qa-decision")![0]!, "non-Proxy QA decision");
  const decision = await verifyNonProxyQaDecisionEvidence(decisionValue);
  const replayed = await reviewNonProxyGenerationOutput({ jobEvents: ledger as readonly unknown[], decisions: [decision], evaluatedAt: decision.evaluatedAt });
  if (replayed.outcome !== "draft-derived" || replayed.candidate === null || !same(replayed.candidate, candidate)) throw new TypeError("candidate must exactly replay from the actual GenerationJob ledger and QA decision bytes");
  if (Date.parse(decision.evaluatedAt) > Date.parse(hostEvaluatedAt) || attestations.some((attestation) => Date.parse(decision.reviewedAt) > Date.parse(attestation.issuedAt) || Date.parse(decision.evaluatedAt) > Date.parse(attestation.issuedAt))) throw new TypeError("attestations cannot predate the replayed QA decision horizon");
}

function assertArtifactInventory(artifacts: readonly ActualByteArtifact[], candidate: FormalizationCandidate): Map<string, ActualByteArtifact[]> {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const byKind = new Map<string, ActualByteArtifact[]>();
  let total = 0;
  for (const artifact of artifacts) {
    if (ids.has(artifact.artifactId)) throw new TypeError("artifact IDs must be unique");
    if (hashes.has(artifact.sha256)) throw new TypeError("artifact bytes cannot be relabelled across IDs or kinds");
    ids.add(artifact.artifactId);
    hashes.add(artifact.sha256);
    total += artifact.byteLength;
    if (!Number.isSafeInteger(total) || total > FORMALIZATION_TOTAL_ARTIFACT_MAX_BYTES) throw new TypeError("formalization artifact set exceeds the total byte budget");
    const values = byKind.get(artifact.kind) ?? [];
    values.push(artifact);
    byKind.set(artifact.kind, values);
  }
  for (const kind of FORMALIZATION_ARTIFACT_KINDS) {
    const count = byKind.get(kind)?.length ?? 0;
    if (kind === "source" ? count !== candidate.sourceAssetHashes.length : count !== 1) throw new TypeError(`formalization artifact inventory has invalid ${kind} cardinality`);
  }
  const sourceHashes = (byKind.get("source") ?? []).map((artifact) => artifact.sha256).sort();
  if (!same(sourceHashes, candidate.sourceAssetHashes)) throw new TypeError("actual source bytes must exactly match the candidate source set");
  const model = byKind.get("model")![0]!;
  const manifest = byKind.get("manifest")![0]!;
  if (model.sha256 !== candidate.modelSha256 || model.byteLength !== candidate.modelByteLength || manifest.sha256 !== candidate.manifestSha256 || manifest.byteLength !== candidate.manifestByteLength) throw new TypeError("candidate output does not match actual model and manifest bytes");
  return byKind;
}

function parseRequest(value: unknown): {
  candidate: FormalizationCandidate;
  artifacts: ActualByteArtifact[];
  attestations: SignedEvidenceAttestation[];
} {
  object(value, "request");
  exact(value, REQUEST_KEYS, "request");
  const candidate = parseFormalizationCandidate(value.candidate);
  array(value.artifacts, "request.artifacts", 40);
  if (value.artifacts.length === 0) throw new TypeError("request.artifacts must be non-empty");
  const artifacts = value.artifacts.map(parseActualByteArtifact);
  array(value.attestations, "request.attestations", FORMALIZATION_SCOPES.length);
  if (value.attestations.length !== FORMALIZATION_SCOPES.length) throw new TypeError("exactly four formalization attestations are required");
  const attestations = value.attestations.map(parseSignedEvidenceAttestation);
  return { candidate, artifacts, attestations };
}

function parseVerificationContext(value: unknown): { evaluatedAt: string; trust: FormalizationTrustConfiguration } {
  object(value, "verification context");
  exact(value, CONTEXT_KEYS, "verification context");
  timestamp(value.evaluatedAt, "verification context.evaluatedAt");
  return { evaluatedAt: value.evaluatedAt, trust: parseTrust(value.trust) };
}

export async function evaluateNonProxyFormalizationReadiness(value: unknown, contextValue: unknown): Promise<FormalizationReadinessResult> {
  const request = parseRequest(value);
  const context = parseVerificationContext(contextValue);
  const byKind = assertArtifactInventory(request.artifacts, request.candidate);
  const artifacts = new Map(request.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const candidateSha256 = await formalizationCandidateSha256(request.candidate);

  for (const artifact of request.artifacts) {
    if (await sha256Hex(artifact.bytes) !== artifact.sha256) throw new TypeError("artifact actual bytes do not match the declared SHA-256");
  }
  await assertStructuredEvidence(byKind, request.candidate, request.attestations, context.evaluatedAt);

  const scopes = new Set<FormalizationScope>();
  const authorityIds = new Set<string>();
  const keyIds = new Set<string>();
  const attestationPayloadSha256s: string[] = [];
  let validUntilMs = Number.POSITIVE_INFINITY;
  for (const attestation of request.attestations) {
    if (scopes.has(attestation.scope)) throw new TypeError("formalization attestation scopes must be unique");
    scopes.add(attestation.scope);
    const issuedAt = Date.parse(attestation.issuedAt);
    const expiresAt = Date.parse(attestation.expiresAt);
    const evaluatedAt = Date.parse(context.evaluatedAt);
    if (issuedAt > evaluatedAt || expiresAt <= evaluatedAt || expiresAt - issuedAt > context.trust.maximumAttestationLifetimeMs) throw new TypeError("attestation is outside its allowed time window");
    if (attestation.retentionUntil !== null && Date.parse(attestation.retentionUntil) <= evaluatedAt) throw new TypeError("actual-wear consent retention is expired");
    validUntilMs = Math.min(validUntilMs, expiresAt, attestation.retentionUntil === null ? Number.POSITIVE_INFINITY : Date.parse(attestation.retentionUntil));

    const measurementSetSha256 = request.candidate.requirements.physical.measurementSetSha256;
    const output = { manifestSha256: request.candidate.manifestSha256, modelSha256: request.candidate.modelSha256, manifestByteLength: request.candidate.manifestByteLength, modelByteLength: request.candidate.modelByteLength };
    const expectedBinding = {
      tenantId: request.candidate.tenantId,
      frameModelId: request.candidate.frameModelId,
      frameVariantId: request.candidate.frameVariantId,
      jobId: request.candidate.generation.jobId,
      canonicalInputSha256: request.candidate.generation.canonicalInputSha256,
      reviewHeadEventSha256: request.candidate.generation.reviewHeadEventSha256,
      generatorInputSha256: request.candidate.generation.generatorInputSha256,
      measurementSetSha256,
      sourceAssetSha256s: request.candidate.sourceAssetHashes,
      output,
      candidateSha256,
    };
    for (const [key, expected] of Object.entries(expectedBinding)) {
      if (!same((attestation as unknown as Record<string, unknown>)[key], expected)) throw new TypeError(`attestation cannot substitute candidate ${key}`);
    }

    const expectedArtifacts = requiredArtifactsForScope(attestation.scope, byKind).map(descriptor).sort((left, right) => left.artifactId.localeCompare(right.artifactId));
    if (!same(attestation.artifacts, expectedArtifacts)) throw new TypeError("attestation signed artifact descriptors do not match required actual bytes");
    assertClaimBindsArtifacts(attestation, artifacts, request.candidate);

    const trusted = context.trust.trustedKeys[attestation.keyId];
    if (!trusted || trusted.authorityId !== attestation.authorityId || trusted.tenantId !== request.candidate.tenantId || !trusted.scopes.includes(attestation.scope)) throw new TypeError("attestation key is not trusted for this tenant, authority, and scope");
    if (keyIds.has(attestation.keyId) || authorityIds.has(attestation.authorityId)) throw new TypeError("formalization scopes require independent keys and authorities");
    keyIds.add(attestation.keyId);
    authorityIds.add(attestation.authorityId);
    const key = await crypto.subtle.importKey("jwk", trusted.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64Bytes(attestation.signatureBase64),
      new TextEncoder().encode(canonicalJson(attestationPayload(attestation))),
    );
    if (!verified) throw new TypeError("attestation ES256 signature verification failed");
    attestationPayloadSha256s.push(await sha256Hex(canonicalJson(attestationPayload(attestation))));
  }

  if (FORMALIZATION_SCOPES.some((scope) => !scopes.has(scope))) throw new TypeError("a required formalization scope is missing");
  return Object.freeze({
    readiness: "evidence-package-verified-for-authorized-human-review-input",
    candidateSha256,
    attestedScopes: Object.freeze([...FORMALIZATION_SCOPES]),
    artifactDigestIntegrityVerified: true,
    structuredModelAndMeasurementValidated: true,
    signaturesVerified: true,
    evaluatedAt: context.evaluatedAt,
    validUntil: new Date(validUntilMs).toISOString(),
    attestationPayloadSha256s: Object.freeze(attestationPayloadSha256s.sort()),
    authority: FORMALIZATION_AUTHORITY_DENIAL,
  });
}
