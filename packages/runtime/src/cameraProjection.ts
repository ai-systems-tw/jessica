import {
  CAMERA_PROJECTION_BINDING_SCHEME,
  CAMERA_PROJECTION_PROFILE_TYPE,
  assertCameraProjectionSafeTree,
  cameraProjectionProfileIdentity,
  cameraProjectionProfileSigningPayload,
  canonicalJson,
  parseCameraProjectionProfileV1,
  sha256Hex,
  type CameraFacingMode,
  type CameraProjectionProfileV1,
} from "../../contracts/src/index.js";
import type { CameraCalibration, ImageSize } from "./types.js";

export { CAMERA_PROJECTION_BINDING_SCHEME, CAMERA_PROJECTION_PROFILE_TYPE, cameraProjectionProfileSigningPayload, parseCameraProjectionProfileV1 } from "../../contracts/src/index.js";
export type { CameraFacingMode, CameraProjectionAuthorityClass, CameraProjectionProfileV1 } from "../../contracts/src/index.js";
export const CAMERA_PROJECTION_MAX_PROFILES = 64;

export type CameraProjectionTrustedKey = { readonly authorityId: string; readonly authorityClass: "production"; readonly publicJwk: JsonWebKey };
export type CameraProjectionTrust = { readonly trustedKeys: Readonly<Record<string, CameraProjectionTrustedKey>>; readonly nowEpochMs: number; readonly maximumClockSkewMs: number; readonly maximumProfileLifetimeMs: number; readonly maximumProfileAgeMs: number };
export type VerifiedCameraProjectionProfileV1 = CameraProjectionProfileV1 & { readonly verification: { readonly status: "verified-production"; readonly verifiedAt: string } };
export type VerifiedCameraProjectionProfileSet = { readonly profiles: readonly VerifiedCameraProjectionProfileV1[]; readonly profileIds: readonly string[]; readonly admissionDeadlineEpochMs: number };
export type CameraProjectionEvidence = { readonly trackSettings: { readonly width: number | undefined; readonly height: number | undefined; readonly aspectRatio: number | undefined; readonly facingMode: string | undefined; readonly deviceId: string | undefined; readonly resizeMode: string | undefined; readonly zoom: number | undefined; readonly pan: number | undefined; readonly tilt: number | undefined }; readonly videoSize: ImageSize };
export type AdmittedCameraProjection = { readonly admission: "verified-production" | "fixture-only"; readonly productionAuthority: boolean; readonly profileId: string; readonly profileSha256: string; readonly calibrationArtifactSha256: string; readonly calibrationArtifactByteLength: number; readonly sourceSize: ImageSize; readonly intrinsics: CameraCalibration["intrinsics"]; readonly facingMode: CameraFacingMode; readonly display: CameraProjectionProfileV1["display"] };
export type SyntheticFixtureCameraProjectionOptions = { widthPx: number; heightPx: number; fxPx: number; fyPx: number; cxPx: number; cyPx: number; objectFit?: "contain" | "cover" };

const verifiedSets = new WeakSet<object>();
const admittedProjections = new WeakSet<object>();
const calibrationOwners = new WeakMap<object, AdmittedCameraProjection>();
function freeze<T>(value: T): T { if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value; for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> { const decoded = atob(value); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)); }
function publicP256Jwk(value: unknown): JsonWebKey {
  assertCameraProjectionSafeTree(value);
  const copy = structuredClone(value); if (typeof copy !== "object" || copy === null || Array.isArray(copy)) throw new TypeError("trusted camera projection JWK must be a plain object");
  const record = copy as Record<string, unknown>; const keys = Object.keys(record);
  if (keys.some((key) => !["kty", "crv", "x", "y", "use", "alg", "key_ops", "ext"].includes(key)) || record.kty !== "EC" || record.crv !== "P-256" || typeof record.x !== "string" || typeof record.y !== "string" || record.d !== undefined) throw new TypeError("trusted camera projection JWK must be a public P-256 key");
  if (!/^[A-Za-z0-9_-]{43}$/.test(record.x) || !/^[A-Za-z0-9_-]{43}$/.test(record.y) || record.use !== "sig" || record.alg !== "ES256") throw new TypeError("trusted camera projection JWK must be canonical ES256 signing material");
  if (record.key_ops !== undefined && (!Array.isArray(record.key_ops) || record.key_ops.length !== 1 || record.key_ops[0] !== "verify")) throw new TypeError("trusted camera projection JWK operations are invalid");
  if (record.ext !== undefined && record.ext !== true) throw new TypeError("trusted camera projection JWK extractability declaration is invalid");
  return freeze(copy as JsonWebKey);
}
export function parseCameraProjectionTrust(trust: CameraProjectionTrust): CameraProjectionTrust {
  assertCameraProjectionSafeTree(trust);
  if (Object.keys(trust as unknown as Record<string, unknown>).some((key) => !["trustedKeys", "nowEpochMs", "maximumClockSkewMs", "maximumProfileLifetimeMs", "maximumProfileAgeMs"].includes(key))) throw new TypeError("camera projection trust contains unknown fields");
  for (const [label, value] of [["nowEpochMs", trust.nowEpochMs], ["maximumClockSkewMs", trust.maximumClockSkewMs], ["maximumProfileLifetimeMs", trust.maximumProfileLifetimeMs], ["maximumProfileAgeMs", trust.maximumProfileAgeMs]] as const) if (!Number.isSafeInteger(value) || value < (label === "maximumClockSkewMs" ? 0 : 1)) throw new TypeError(`camera projection trust ${label} is invalid`);
  const keys: Record<string, CameraProjectionTrustedKey> = {};
  for (const [keyId, item] of Object.entries(trust.trustedKeys)) {
    if (Object.keys(item as unknown as Record<string, unknown>).some((key) => !["authorityId", "authorityClass", "publicJwk"].includes(key))) throw new TypeError("camera projection trusted key contains unknown fields");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId) || item.authorityClass !== "production" || typeof item.authorityId !== "string") throw new TypeError("camera projection trusted key binding is invalid");
    keys[keyId] = freeze({ authorityId: item.authorityId, authorityClass: "production", publicJwk: publicP256Jwk(item.publicJwk) });
  }
  return freeze({ ...structuredClone({ nowEpochMs: trust.nowEpochMs, maximumClockSkewMs: trust.maximumClockSkewMs, maximumProfileLifetimeMs: trust.maximumProfileLifetimeMs, maximumProfileAgeMs: trust.maximumProfileAgeMs }), trustedKeys: keys });
}

async function verifyProfile(value: unknown, trust: CameraProjectionTrust): Promise<VerifiedCameraProjectionProfileV1> {
  const profile = parseCameraProjectionProfileV1(value); if (profile.authority.class !== "production") throw new TypeError("fixture camera projection profiles are never production admissible");
  const trusted = trust.trustedKeys[profile.signature.keyId]; if (!trusted || trusted.authorityId !== profile.authority.authorityId) throw new TypeError("camera projection signing authority is not trusted for production");
  const digest = await sha256Hex(canonicalJson(cameraProjectionProfileIdentity(profile))); if (profile.profileSha256 !== digest || profile.profileId !== `cppv1_${digest}`) throw new TypeError("camera projection profile digest or identity is inconsistent");
  const issued = Date.parse(profile.issuedAt); const expires = Date.parse(profile.expiresAt);
  if (issued > trust.nowEpochMs + trust.maximumClockSkewMs || trust.nowEpochMs >= expires || expires - issued > trust.maximumProfileLifetimeMs || trust.nowEpochMs - issued >= trust.maximumProfileAgeMs) throw new TypeError("camera projection profile is stale, future, or outside host freshness policy");
  const key = await crypto.subtle.importKey("jwk", trusted.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytesFromBase64(profile.signature.signatureBase64), new TextEncoder().encode(canonicalJson(cameraProjectionProfileSigningPayload(profile))))) throw new TypeError("camera projection signature verification failed");
  return freeze({ ...profile, verification: { status: "verified-production" as const, verifiedAt: new Date(trust.nowEpochMs).toISOString() } });
}

export async function verifyCameraProjectionProfileSet(value: unknown, trustValue: CameraProjectionTrust): Promise<VerifiedCameraProjectionProfileSet> {
  assertCameraProjectionSafeTree(value); if (!Array.isArray(value) || value.length === 0 || value.length > CAMERA_PROJECTION_MAX_PROFILES) throw new TypeError("camera projection profile set must be non-empty and bounded");
  const profileValues = structuredClone(value); const trust = parseCameraProjectionTrust(trustValue);
  const profiles = await Promise.all(profileValues.map((profile) => verifyProfile(profile, trust)));
  const ids = profiles.map((profile) => profile.profileId); if (new Set(ids).size !== ids.length) throw new TypeError("camera projection profile set contains duplicate identities");
  const sourceKeys = profiles.map((profile) => JSON.stringify([profile.binding.deviceIdSha256, profile.stream.widthPx, profile.stream.heightPx, profile.stream.facingMode]));
  if (new Set(sourceKeys).size !== sourceKeys.length) throw new TypeError("camera projection profile set contains an ambiguous active source tuple");
  const admissionDeadlineEpochMs = Math.min(...profiles.map((profile) => Math.min(Date.parse(profile.expiresAt), Date.parse(profile.issuedAt) + trust.maximumProfileAgeMs)));
  const set = freeze({ profiles: freeze(profiles), profileIds: freeze(ids), admissionDeadlineEpochMs }); verifiedSets.add(set); return set;
}

export async function cameraDeviceBindingSha256(deviceId: string): Promise<string> { if (typeof deviceId !== "string" || deviceId.length === 0 || deviceId.length > 4096) throw new TypeError("camera device binding source is unavailable"); return sha256Hex(new TextEncoder().encode(`jessica-camera-device-v1\0${deviceId}`)); }
function admitted(profile: CameraProjectionProfileV1, admission: AdmittedCameraProjection["admission"]): AdmittedCameraProjection {
  const result = freeze({ admission, productionAuthority: admission === "verified-production", profileId: profile.profileId, profileSha256: profile.profileSha256, calibrationArtifactSha256: profile.calibrationArtifact.sha256, calibrationArtifactByteLength: profile.calibrationArtifact.byteLength, sourceSize: { width: profile.stream.widthPx, height: profile.stream.heightPx }, intrinsics: { ...profile.intrinsics }, facingMode: profile.stream.facingMode, display: { ...profile.display } }); admittedProjections.add(result); return result;
}
export async function resolveCameraProjection(set: VerifiedCameraProjectionProfileSet, evidenceValue: CameraProjectionEvidence, nowEpochMs: number): Promise<AdmittedCameraProjection> {
  if (!verifiedSets.has(set)) throw new TypeError("camera projection set is not verified");
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs >= set.admissionDeadlineEpochMs) throw new TypeError("camera projection profile set is no longer current at active-camera admission");
  const profiles = set.profiles; const evidence = freeze(structuredClone(evidenceValue));
  const { width, height, aspectRatio, facingMode, deviceId, resizeMode, zoom, pan, tilt } = evidence.trackSettings; if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || typeof facingMode !== "string" || !deviceId || resizeMode !== "none") throw new TypeError("camera projection track settings are incomplete or rescaled");
  const w = width as number; const h = height as number; if (!Number.isSafeInteger(evidence.videoSize.width) || !Number.isSafeInteger(evidence.videoSize.height) || evidence.videoSize.width <= 0 || evidence.videoSize.height <= 0) throw new TypeError("camera projection intrinsic video size is unavailable");
  if (aspectRatio !== undefined && (typeof aspectRatio !== "number" || !Number.isFinite(aspectRatio) || Math.abs(aspectRatio - w / h) > 1e-6)) throw new TypeError("camera projection track aspect ratio is inconsistent");
  if ((zoom !== undefined && zoom !== 1) || (pan !== undefined && pan !== 0) || (tilt !== undefined && tilt !== 0)) throw new TypeError("camera projection track optical controls differ from calibration");
  const binding = await cameraDeviceBindingSha256(deviceId);
  if (!verifiedSets.has(set) || set.profiles !== profiles) throw new TypeError("camera projection verification capability changed");
  const matches = profiles.filter((profile) => profile.binding.deviceIdSha256 === binding && profile.stream.widthPx === w && profile.stream.heightPx === h && profile.stream.facingMode === facingMode && evidence.videoSize.width === w && evidence.videoSize.height === h);
  if (matches.length !== 1) throw new TypeError("exactly one current camera projection profile must match the active source"); return admitted(matches[0]!, "verified-production");
}

export function syntheticFixtureCameraCalibrationArtifactBytes(options: SyntheticFixtureCameraProjectionOptions): Uint8Array<ArrayBuffer> {
  const artifact = {
    schemaVersion: 1,
    type: "jessica.synthetic-camera-calibration-fixture",
    sourceSize: { widthPx: options.widthPx, heightPx: options.heightPx },
    intrinsics: { fxPx: options.fxPx, fyPx: options.fyPx, cxPx: options.cxPx, cyPx: options.cyPx },
    distortionModel: "none",
    display: { objectFit: options.objectFit ?? "contain", objectPosition: "center", mirrorMode: "none" },
    authority: "fixture-only-no-physical-evidence",
  };
  return new TextEncoder().encode(canonicalJson(artifact));
}
export async function createSyntheticFixtureCameraProjection(options: SyntheticFixtureCameraProjectionOptions): Promise<AdmittedCameraProjection> {
  const artifactBytes = syntheticFixtureCameraCalibrationArtifactBytes(options);
  const artifactSha256 = await sha256Hex(artifactBytes);
  const identity = { schemaVersion: 1 as const, type: CAMERA_PROJECTION_PROFILE_TYPE, binding: { scheme: CAMERA_PROJECTION_BINDING_SCHEME, deviceIdSha256: "0".repeat(64) }, stream: { widthPx: options.widthPx, heightPx: options.heightPx, aspectRatio: options.widthPx / options.heightPx, facingMode: "environment" as const, orientation: options.widthPx === options.heightPx ? "square" as const : options.widthPx > options.heightPx ? "landscape" as const : "portrait" as const }, intrinsics: { fxPx: options.fxPx, fyPx: options.fyPx, cxPx: options.cxPx, cyPx: options.cyPx }, distortionModel: "none" as const, display: { objectFit: options.objectFit ?? "contain", objectPosition: "center" as const, mirrorMode: "none" as const }, calibrationArtifact: { sha256: artifactSha256, byteLength: artifactBytes.byteLength }, authority: { class: "fixture" as const, authorityId: "fixture-only-self-test", provenance: "synthetic-self-test" as const }, issuedAt: "2000-01-01T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z" };
  const digest = await sha256Hex(canonicalJson(identity)); const profile = parseCameraProjectionProfileV1({ ...identity, profileId: `cppv1_${digest}`, profileSha256: digest, signature: { algorithm: "ES256", keyId: "fixture-not-production", signatureBase64: btoa(String.fromCharCode(...new Uint8Array(64))) } }); return admitted(profile, "fixture-only");
}
export function cameraCalibrationFromProjection(projection: AdmittedCameraProjection, viewportSize: ImageSize): CameraCalibration {
  if (!admittedProjections.has(projection) || !Number.isFinite(viewportSize.width) || !Number.isFinite(viewportSize.height) || viewportSize.width <= 0 || viewportSize.height <= 0) throw new TypeError("camera projection or viewport was not admitted");
  const calibration = freeze({ projectionIdentity: { profileId: projection.profileId, profileSha256: projection.profileSha256, admission: projection.admission }, sourceSize: { ...projection.sourceSize }, viewportSize: { ...viewportSize }, intrinsics: { ...projection.intrinsics }, displayMirror: projection.display.mirrorMode, objectFit: projection.display.objectFit });
  calibrationOwners.set(calibration, projection); return calibration;
}
export function assertProductionAdmittedCameraProjection(projection: AdmittedCameraProjection): void {
  if (!admittedProjections.has(projection) || projection.admission !== "verified-production" || projection.productionAuthority !== true) throw new TypeError("public-live requires a production-admitted camera projection capability");
}
export function assertCameraCalibrationForProjection(calibration: CameraCalibration, projection: AdmittedCameraProjection): void {
  if (calibrationOwners.get(calibration) !== projection) throw new TypeError("camera calibration is not an immutable snapshot of the admitted projection");
}
