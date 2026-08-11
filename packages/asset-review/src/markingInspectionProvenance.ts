import {
  MARKING_INSPECTION_REQUIRED_SURFACES,
  MARKING_INSPECTION_TOTAL_ARTIFACT_MAX_BYTES,
  MARKING_PROVENANCE_SCOPES,
  captureProvenanceAttestationPayload,
  markingInspectionAttestationPayload,
  parseCaptureProvenanceAttestation,
  parseMarkingCandidate,
  parseMarkingInspectionArtifact,
  parseMarkingInspectionAttestation,
  parseReportedNoTempleMarkingAttestation,
  reportedNoTempleMarkingAttestationPayload,
  type CaptureProvenanceAttestation,
  type MarkingCaptureRole,
  type MarkingInspectionArtifact,
  type MarkingInspectionAttestation,
  type MarkingProvenanceScope,
  type MarkingProvenanceTrustConfiguration,
  type MarkingSourceDescriptor,
  type ReportedNoTempleMarkingAttestation,
} from "../../contracts/src/markingInspectionProvenance.js";
import { canonicalJson, sha256Hex } from "../../contracts/src/generationJob.js";
import { formalizationCandidateSha256, type FormalizationCandidate } from "../../contracts/src/nonProxyFormalizationReadiness.js";

export const MARKING_INSPECTION_AUTHORITY_DENIAL = Object.freeze({
  qaApproved: false,
  assetVersionCreated: false,
  assetVersionPromoted: false,
  recommendedForLive: false,
  activeDeployment: false,
  publication: false,
  gates: false,
} as const);

export type MarkingInspectionProvenanceResult = Readonly<{
  reportedObservation: "reported-no-temple-marking";
  inspectionOutcome: "no-dimension-marking-observed-under-policy" | "dimension-marking-observed-under-policy";
  markingTranscriptionRoute: "not-applicable-under-policy" | "required";
  specimenId: string;
  candidateSha256: string;
  captureProvenancePayloadSha256: string;
  markingInspectionPayloadSha256: string;
  supersededAttestationSha256: string;
  verifiedCaptureProvenance: readonly Readonly<{
    artifactId: string;
    sha256: string;
    byteLength: number;
    captureRole: MarkingCaptureRole;
    capturedAt: string;
  }>[];
  inspectedSurfaces: readonly (typeof MARKING_INSPECTION_REQUIRED_SURFACES)[number][];
  requirements: Readonly<{
    verifiedCaliperEvidenceRequired: true;
    allSixPhysicalDimensionsRequired: true;
    j1mMarkingSourceRequired: true;
    g1MarkingSourceRequired: true;
  }>;
  evaluatedAt: string;
  validUntil: string;
  authority: typeof MARKING_INSPECTION_AUTHORITY_DENIAL;
}>;

const REQUEST_KEYS = ["candidate", "artifacts", "captureProvenanceAttestation", "markingInspectionAttestation"] as const;
const CONTEXT_KEYS = ["evaluatedAt", "expectedSupersededAttestationSha256", "trust"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

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

function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be an RFC 3339 UTC timestamp`);
  const parsed = Date.parse(value);
  const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) throw new TypeError(`${path} must be a real canonical UTC instant`);
}

function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

function descriptor(artifact: MarkingInspectionArtifact): MarkingSourceDescriptor {
  return { artifactId: artifact.artifactId, kind: "source", sourceRole: null, sha256: artifact.sha256, byteLength: artifact.byteLength };
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value); const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function parseTrust(value: unknown): MarkingProvenanceTrustConfiguration {
  object(value, "trust");
  exact(value, ["trustedKeys", "maximumAttestationLifetimeMs", "maximumEvidenceAgeMs"], "trust");
  for (const key of ["maximumAttestationLifetimeMs", "maximumEvidenceAgeMs"] as const) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1 || (value[key] as number) > 31 * 24 * 60 * 60 * 1000) throw new TypeError(`trust.${key} is invalid`);
  }
  object(value.trustedKeys, "trust.trustedKeys");
  const entries = Object.entries(value.trustedKeys);
  if (entries.length < 2 || entries.length > 16) throw new TypeError("trust.trustedKeys must contain 2 to 16 keys");
  const trustedKeys: Record<string, MarkingProvenanceTrustConfiguration["trustedKeys"][string]> = {};
  const fingerprints = new Set<string>();
  for (const [keyId, raw] of entries) {
    if (!ID.test(keyId)) throw new TypeError("trust keyId must be a bounded identifier");
    object(raw, `trust.trustedKeys.${keyId}`);
    exact(raw, ["authorityId", "tenantId", "scopes", "publicJwk"], `trust.trustedKeys.${keyId}`);
    if (typeof raw.authorityId !== "string" || !ID.test(raw.authorityId) || typeof raw.tenantId !== "string" || !ID.test(raw.tenantId)) throw new TypeError("trusted key identity is invalid");
    array(raw.scopes, `trust.trustedKeys.${keyId}.scopes`, MARKING_PROVENANCE_SCOPES.length);
    if (raw.scopes.length === 0 || raw.scopes.some((scope) => !MARKING_PROVENANCE_SCOPES.includes(scope as MarkingProvenanceScope)) || new Set(raw.scopes).size !== raw.scopes.length || canonicalJson(raw.scopes) !== canonicalJson([...raw.scopes].sort())) throw new TypeError("trusted key scopes must be supported, unique, and sorted");
    object(raw.publicJwk, `trust.trustedKeys.${keyId}.publicJwk`);
    exact(raw.publicJwk, ["key_ops", "ext", "kty", "x", "y", "crv", "use", "alg"], `trust.trustedKeys.${keyId}.publicJwk`);
    array(raw.publicJwk.key_ops, `trust.trustedKeys.${keyId}.publicJwk.key_ops`, 1);
    if (raw.publicJwk.key_ops.length !== 1 || raw.publicJwk.key_ops[0] !== "verify" || raw.publicJwk.ext !== true || raw.publicJwk.kty !== "EC" || raw.publicJwk.crv !== "P-256" || raw.publicJwk.use !== "sig" || raw.publicJwk.alg !== "ES256" || typeof raw.publicJwk.x !== "string" || typeof raw.publicJwk.y !== "string" || raw.publicJwk.x.length !== 43 || raw.publicJwk.y.length !== 43) throw new TypeError("trusted JWK must be an ES256 public P-256 verification key");
    const fingerprint = `${raw.publicJwk.crv}:${raw.publicJwk.x}:${raw.publicJwk.y}`;
    if (fingerprints.has(fingerprint)) throw new TypeError("capture and inspection trust must use independent public keys");
    fingerprints.add(fingerprint);
    trustedKeys[keyId] = { authorityId: raw.authorityId, tenantId: raw.tenantId, scopes: [...raw.scopes] as MarkingProvenanceScope[], publicJwk: structuredClone(raw.publicJwk) };
  }
  return { trustedKeys, maximumAttestationLifetimeMs: value.maximumAttestationLifetimeMs as number, maximumEvidenceAgeMs: value.maximumEvidenceAgeMs as number };
}

function parseRequest(value: unknown): {
  candidate: FormalizationCandidate;
  artifacts: MarkingInspectionArtifact[];
  capture: CaptureProvenanceAttestation;
  inspection: MarkingInspectionAttestation;
} {
  object(value, "request"); exact(value, REQUEST_KEYS, "request");
  const candidate = parseMarkingCandidate(value.candidate);
  array(value.artifacts, "request.artifacts", 33);
  if (value.artifacts.length < 4) throw new TypeError("request requires at least three surface captures and one reported attestation");
  let totalBytes = 0;
  for (const [index, artifact] of value.artifacts.entries()) {
    object(artifact, `request.artifacts.${index}`);
    if (!(artifact.bytes instanceof Uint8Array)) throw new TypeError(`request.artifacts.${index}.bytes must be actual byte storage`);
    totalBytes += artifact.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MARKING_INSPECTION_TOTAL_ARTIFACT_MAX_BYTES) throw new TypeError("marking inspection artifact set exceeds the total byte budget before snapshot");
  }
  return {
    candidate,
    artifacts: value.artifacts.map(parseMarkingInspectionArtifact),
    capture: parseCaptureProvenanceAttestation(value.captureProvenanceAttestation),
    inspection: parseMarkingInspectionAttestation(value.markingInspectionAttestation),
  };
}

function parseContext(value: unknown): { evaluatedAt: string; expectedSupersededAttestationSha256: string; trust: MarkingProvenanceTrustConfiguration } {
  object(value, "verification context"); exact(value, CONTEXT_KEYS, "verification context");
  timestamp(value.evaluatedAt, "verification context.evaluatedAt");
  if (typeof value.expectedSupersededAttestationSha256 !== "string" || !HASH.test(value.expectedSupersededAttestationSha256)) throw new TypeError("verification context expected lineage head must be a SHA-256 digest");
  return { evaluatedAt: value.evaluatedAt, expectedSupersededAttestationSha256: value.expectedSupersededAttestationSha256, trust: parseTrust(value.trust) };
}

function parseCanonicalReport(artifact: MarkingInspectionArtifact) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes); } catch { throw new TypeError("reported attestation must be canonical UTF-8 JSON"); }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; } catch { throw new TypeError("reported attestation must be canonical JSON"); }
  if (canonicalJson(parsed) !== text) throw new TypeError("reported attestation bytes must be canonical JSON");
  return parseReportedNoTempleMarkingAttestation(parsed);
}

async function verifySignature(attestation: ReportedNoTempleMarkingAttestation | CaptureProvenanceAttestation | MarkingInspectionAttestation, payload: unknown, trust: MarkingProvenanceTrustConfiguration, tenantId: string): Promise<void> {
  const trusted = trust.trustedKeys[attestation.keyId];
  if (!trusted || trusted.authorityId !== attestation.authorityId || trusted.tenantId !== tenantId || !trusted.scopes.includes(attestation.scope)) throw new TypeError("attestation key is not trusted for this tenant, authority, and scope");
  const key = await crypto.subtle.importKey("jwk", trusted.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64Bytes(attestation.signatureBase64), new TextEncoder().encode(canonicalJson(payload)))) throw new TypeError("attestation ES256 signature verification failed");
}

function assertAttestationTime(attestation: ReportedNoTempleMarkingAttestation | CaptureProvenanceAttestation | MarkingInspectionAttestation, evaluatedAt: number, trust: MarkingProvenanceTrustConfiguration): void {
  const issuedAt = Date.parse(attestation.issuedAt); const expiresAt = Date.parse(attestation.expiresAt);
  if (issuedAt > evaluatedAt || expiresAt <= evaluatedAt || expiresAt - issuedAt > trust.maximumAttestationLifetimeMs) throw new TypeError("attestation is outside its allowed time window");
}

export async function evaluateMarkingInspectionAndSourceProvenance(value: unknown, contextValue: unknown): Promise<MarkingInspectionProvenanceResult> {
  const request = parseRequest(value);
  const context = parseContext(contextValue);
  const evaluatedAt = Date.parse(context.evaluatedAt);
  const candidateSha256 = await formalizationCandidateSha256(request.candidate);

  const ids = new Set<string>(); const digests = new Set<string>(); let totalBytes = 0;
  for (const artifact of request.artifacts) {
    if (ids.has(artifact.artifactId)) throw new TypeError("artifact IDs must be unique");
    if (digests.has(artifact.sha256)) throw new TypeError("artifact bytes cannot be relabelled across identities or kinds");
    ids.add(artifact.artifactId); digests.add(artifact.sha256);
    totalBytes += artifact.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MARKING_INSPECTION_TOTAL_ARTIFACT_MAX_BYTES) throw new TypeError("marking inspection artifact set exceeds the total byte budget");
    if (await sha256Hex(artifact.bytes) !== artifact.sha256) throw new TypeError("artifact actual bytes do not match the declared SHA-256");
  }
  const sources = request.artifacts.filter((artifact) => artifact.kind === "source");
  const reports = request.artifacts.filter((artifact) => artifact.kind === "reported-no-temple-marking-attestation");
  if (reports.length !== 1 || sources.length !== request.candidate.sourceAssetHashes.length) throw new TypeError("artifact inventory must contain the exact source set and one reported attestation");
  if (!same(sources.map((artifact) => artifact.sha256).sort(), request.candidate.sourceAssetHashes)) throw new TypeError("actual source bytes must exactly match the candidate source set");
  const reportArtifact = reports[0]!; const report = parseCanonicalReport(reportArtifact);

  const identity = {
    candidateSha256,
    tenantId: request.candidate.tenantId,
    frameModelId: request.candidate.frameModelId,
    frameVariantId: request.candidate.frameVariantId,
    jobId: request.candidate.generation.jobId,
    sourceAssetSha256s: request.candidate.sourceAssetHashes,
  };
  for (const [key, expected] of Object.entries(identity)) {
    if (!same((request.capture as unknown as Record<string, unknown>)[key], expected) || !same((request.inspection as unknown as Record<string, unknown>)[key], expected)) throw new TypeError(`attestations cannot substitute candidate ${key}`);
  }
  if (request.capture.specimenId !== request.inspection.specimenId || report.specimenId !== request.capture.specimenId) throw new TypeError("report, captures, and inspection must identify the same specimen");
  if (report.tenantId !== request.candidate.tenantId || report.frameModelId !== request.candidate.frameModelId || report.frameVariantId !== request.candidate.frameVariantId) throw new TypeError("reported attestation cannot cross candidate identity");

  const expectedDescriptors = sources.map(descriptor).sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  if (!same(request.capture.artifacts, expectedDescriptors)) throw new TypeError("capture provenance descriptors must bind the exact actual source bytes with sourceRole:null");
  const sourceById = new Map(sources.map((artifact) => [artifact.artifactId, artifact]));
  const captureById = new Map(request.capture.captures.map((capture) => [capture.artifactId, capture]));
  if (captureById.size !== sources.length || [...sourceById.keys()].some((artifactId) => !captureById.has(artifactId))) throw new TypeError("capture provenance must map every exact source artifact once");
  for (const capture of request.capture.captures) {
    if (capture.specimenId !== request.capture.specimenId) throw new TypeError("capture provenance cannot mix specimens");
    if (Date.parse(capture.capturedAt) > Date.parse(request.capture.issuedAt)) throw new TypeError("capture provenance cannot predate a claimed capture");
    if (evaluatedAt - Date.parse(capture.capturedAt) > context.trust.maximumEvidenceAgeMs) throw new TypeError("capture provenance evidence is stale");
  }

  const capturePayload = captureProvenanceAttestationPayload(request.capture);
  const capturePayloadSha256 = await sha256Hex(canonicalJson(capturePayload));
  if (request.inspection.captureProvenancePayloadSha256 !== capturePayloadSha256) throw new TypeError("marking inspection must bind the exact verified capture-provenance payload");
  if (request.inspection.reportArtifactId !== reportArtifact.artifactId || request.inspection.supersedesAttestationSha256 !== reportArtifact.sha256 || context.expectedSupersededAttestationSha256 !== reportArtifact.sha256) throw new TypeError("marking inspection must supersede the host-expected exact reported attestation head");
  if (Date.parse(report.reportedAt) > Date.parse(request.inspection.inspectedAt)) throw new TypeError("inspection cannot predate the superseded report");
  if (Date.parse(report.issuedAt) > Date.parse(request.capture.issuedAt)) throw new TypeError("capture provenance cannot predate the signed reported observation");
  if (evaluatedAt - Date.parse(report.reportedAt) > context.trust.maximumEvidenceAgeMs) throw new TypeError("reported attestation evidence is stale");
  if (Date.parse(request.capture.issuedAt) > Date.parse(request.inspection.inspectedAt) || Date.parse(request.inspection.inspectedAt) > Date.parse(request.inspection.issuedAt)) throw new TypeError("inspection time must follow verified provenance and precede inspection issuance");
  if (evaluatedAt - Date.parse(request.inspection.inspectedAt) > context.trust.maximumEvidenceAgeMs) throw new TypeError("marking inspection evidence is stale");

  for (const surface of request.inspection.surfaceInspections) {
    const source = sourceById.get(surface.sourceArtifactId); const capture = captureById.get(surface.sourceArtifactId);
    if (!source || !capture) throw new TypeError("surface inspection must bind actual source bytes in verified capture provenance");
    if (capture.captureRole !== "marking") throw new TypeError("surface inspection requires a verified marking capture role");
    if (capture.specimenId !== request.inspection.specimenId || Date.parse(capture.capturedAt) > Date.parse(request.inspection.inspectedAt)) throw new TypeError("surface inspection cannot substitute specimen or predate its capture");
  }

  assertAttestationTime(report, evaluatedAt, context.trust); assertAttestationTime(request.capture, evaluatedAt, context.trust); assertAttestationTime(request.inspection, evaluatedAt, context.trust);
  if (new Set([report.keyId, request.capture.keyId, request.inspection.keyId]).size !== 3 || new Set([report.authorityId, request.capture.authorityId, request.inspection.authorityId]).size !== 3) throw new TypeError("report, capture provenance, and marking inspection require independent keys and authorities");
  await verifySignature(report, reportedNoTempleMarkingAttestationPayload(report), context.trust, request.candidate.tenantId);
  await verifySignature(request.capture, capturePayload, context.trust, request.candidate.tenantId);
  const inspectionPayload = markingInspectionAttestationPayload(request.inspection);
  await verifySignature(request.inspection, inspectionPayload, context.trust, request.candidate.tenantId);
  const inspectionPayloadSha256 = await sha256Hex(canonicalJson(inspectionPayload));

  const absence = request.inspection.surfaceInspections.every((surface) => surface.result === "no-dimension-marking-observed");
  const verifiedCaptureProvenance = request.capture.captures.map((capture) => {
    const artifact = sourceById.get(capture.artifactId)!;
    return Object.freeze({ artifactId: artifact.artifactId, sha256: artifact.sha256, byteLength: artifact.byteLength, captureRole: capture.captureRole, capturedAt: capture.capturedAt });
  });
  const requirements = Object.freeze({ verifiedCaliperEvidenceRequired: true, allSixPhysicalDimensionsRequired: true, j1mMarkingSourceRequired: true, g1MarkingSourceRequired: true } as const);
  return Object.freeze({
    reportedObservation: "reported-no-temple-marking",
    inspectionOutcome: absence ? "no-dimension-marking-observed-under-policy" : "dimension-marking-observed-under-policy",
    markingTranscriptionRoute: absence ? "not-applicable-under-policy" : "required",
    specimenId: request.capture.specimenId,
    candidateSha256,
    captureProvenancePayloadSha256: capturePayloadSha256,
    markingInspectionPayloadSha256: inspectionPayloadSha256,
    supersededAttestationSha256: reportArtifact.sha256,
    verifiedCaptureProvenance: Object.freeze(verifiedCaptureProvenance),
    inspectedSurfaces: Object.freeze([...MARKING_INSPECTION_REQUIRED_SURFACES]),
    requirements,
    evaluatedAt: context.evaluatedAt,
    validUntil: new Date(Math.min(Date.parse(report.expiresAt), Date.parse(request.capture.expiresAt), Date.parse(request.inspection.expiresAt))).toISOString(),
    authority: MARKING_INSPECTION_AUTHORITY_DENIAL,
  });
}
