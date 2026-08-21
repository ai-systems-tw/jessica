export const CAMERA_PROJECTION_PROFILE_TYPE = "jessica.camera-projection-profile" as const;
export const CAMERA_PROJECTION_BINDING_SCHEME = "sha256-media-device-id-v1" as const;

export type CameraFacingMode = "user" | "environment";
export type CameraProjectionAuthorityClass = "production" | "fixture";

export type CameraProjectionProfileV1 = {
  readonly schemaVersion: 1;
  readonly type: typeof CAMERA_PROJECTION_PROFILE_TYPE;
  readonly profileId: string;
  readonly profileSha256: string;
  readonly binding: { readonly scheme: typeof CAMERA_PROJECTION_BINDING_SCHEME; readonly deviceIdSha256: string };
  readonly stream: {
    readonly widthPx: number; readonly heightPx: number; readonly aspectRatio: number;
    readonly facingMode: CameraFacingMode; readonly orientation: "landscape" | "portrait" | "square";
  };
  readonly intrinsics: { readonly fxPx: number; readonly fyPx: number; readonly cxPx: number; readonly cyPx: number };
  readonly distortionModel: "none";
  readonly display: { readonly objectFit: "contain" | "cover"; readonly objectPosition: "center"; readonly mirrorMode: "none" | "css-compositor-x" };
  readonly calibrationArtifact: { readonly sha256: string; readonly byteLength: number };
  readonly authority: {
    readonly class: CameraProjectionAuthorityClass; readonly authorityId: string;
    readonly provenance: "physical-camera-calibration" | "synthetic-self-test";
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: { readonly algorithm: "ES256"; readonly keyId: string; readonly signatureBase64: string };
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Rejects accessors before reading them, exotic prototypes, cycles, aliases, symbols, and sparse arrays. */
export function assertCameraProjectionSafeTree(value: unknown): void {
  const visited = new Set<object>();
  const walk = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null) return;
    if (visited.has(candidate)) throw new TypeError("camera projection profile must not contain cycles or aliases");
    visited.add(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || Object.getOwnPropertySymbols(candidate).length !== 0 || Object.keys(candidate).length !== candidate.length) throw new TypeError("camera projection profile arrays must be dense standard arrays");
    } else if (prototype !== Object.prototype || Object.getOwnPropertySymbols(candidate).length !== 0) throw new TypeError("camera projection profile values must be plain objects");
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(candidate))) {
      if (Array.isArray(candidate) && key === "length") continue;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError("camera projection profile fields must be enumerable data properties");
      walk(descriptor.value);
    }
  };
  walk(value);
}

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${path} must be a plain object`);
}
function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key)); if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  const missing = keys.find((key) => !Object.hasOwn(value, key)); if (missing) throw new TypeError(`${path}.${missing} is required`);
}
function identifier(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${path} must be a bounded identifier`); }
function hash(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`); }
function positiveInteger(value: unknown, path: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(`${path} must be a positive safe integer`); }
function finite(value: unknown, minimum: number, maximum: number, path: string): asserts value is number { if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${path} is outside its finite calibrated range`); }
function timestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UTC.test(value)) throw new TypeError(`${path} must be a canonical UTC timestamp`);
  const parsed = Date.parse(value); const match = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== (match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "")) throw new TypeError(`${path} must be a real canonical UTC instant`);
}
function signature(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(value)) throw new TypeError(`${path} must encode one raw 64-byte ES256 signature`);
  let decoded: string; try { decoded = atob(value); } catch { throw new TypeError(`${path} must be canonical base64`); }
  if (decoded.length !== 64 || btoa(decoded) !== value) throw new TypeError(`${path} must be canonical base64`);
}
function freeze<T>(value: T): T { if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value; for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }

export function cameraProjectionProfileIdentity(profile: CameraProjectionProfileV1): Omit<CameraProjectionProfileV1, "profileId" | "profileSha256" | "signature"> {
  const { profileId: _id, profileSha256: _digest, signature: _signature, ...identity } = profile; return identity;
}
export function cameraProjectionProfileSigningPayload(profile: CameraProjectionProfileV1): Omit<CameraProjectionProfileV1, "signature"> { const { signature: _signature, ...payload } = profile; return payload; }

export function parseCameraProjectionProfileV1(value: unknown): CameraProjectionProfileV1 {
  assertCameraProjectionSafeTree(value);
  const snapshot = structuredClone(value); object(snapshot, "camera projection profile");
  exact(snapshot, ["schemaVersion", "type", "profileId", "profileSha256", "binding", "stream", "intrinsics", "distortionModel", "display", "calibrationArtifact", "authority", "issuedAt", "expiresAt", "signature"], "camera projection profile");
  if (snapshot.schemaVersion !== 1 || snapshot.type !== CAMERA_PROJECTION_PROFILE_TYPE) throw new TypeError("camera projection profile schema or type is unsupported");
  identifier(snapshot.profileId, "camera projection profile.profileId"); hash(snapshot.profileSha256, "camera projection profile.profileSha256");
  object(snapshot.binding, "camera projection profile.binding"); exact(snapshot.binding, ["scheme", "deviceIdSha256"], "camera projection profile.binding");
  if (snapshot.binding.scheme !== CAMERA_PROJECTION_BINDING_SCHEME) throw new TypeError("camera projection binding scheme is unsupported"); hash(snapshot.binding.deviceIdSha256, "camera projection profile.binding.deviceIdSha256");
  object(snapshot.stream, "camera projection profile.stream"); exact(snapshot.stream, ["widthPx", "heightPx", "aspectRatio", "facingMode", "orientation"], "camera projection profile.stream");
  positiveInteger(snapshot.stream.widthPx, "camera projection profile.stream.widthPx"); positiveInteger(snapshot.stream.heightPx, "camera projection profile.stream.heightPx"); finite(snapshot.stream.aspectRatio, .01, 100, "camera projection profile.stream.aspectRatio");
  if (snapshot.stream.aspectRatio !== snapshot.stream.widthPx / snapshot.stream.heightPx) throw new TypeError("camera projection stream aspect ratio does not match its exact dimensions");
  if (snapshot.stream.facingMode !== "user" && snapshot.stream.facingMode !== "environment") throw new TypeError("camera projection facing mode is unsupported");
  const orientation = snapshot.stream.widthPx === snapshot.stream.heightPx ? "square" : snapshot.stream.widthPx > snapshot.stream.heightPx ? "landscape" : "portrait";
  if (snapshot.stream.orientation !== orientation) throw new TypeError("camera projection decoded-geometry orientation label is inconsistent");
  object(snapshot.intrinsics, "camera projection profile.intrinsics"); exact(snapshot.intrinsics, ["fxPx", "fyPx", "cxPx", "cyPx"], "camera projection profile.intrinsics");
  finite(snapshot.intrinsics.fxPx, 1, 1_000_000, "camera projection profile.intrinsics.fxPx"); finite(snapshot.intrinsics.fyPx, 1, 1_000_000, "camera projection profile.intrinsics.fyPx"); finite(snapshot.intrinsics.cxPx, 0, snapshot.stream.widthPx, "camera projection profile.intrinsics.cxPx"); finite(snapshot.intrinsics.cyPx, 0, snapshot.stream.heightPx, "camera projection profile.intrinsics.cyPx");
  if (snapshot.distortionModel !== "none") throw new TypeError("camera projection distortion model is unsupported in v1");
  object(snapshot.display, "camera projection profile.display"); exact(snapshot.display, ["objectFit", "objectPosition", "mirrorMode"], "camera projection profile.display");
  if (snapshot.display.objectFit !== "contain" && snapshot.display.objectFit !== "cover") throw new TypeError("camera projection display objectFit is unsupported"); if (snapshot.display.objectPosition !== "center") throw new TypeError("camera projection v1 supports only centered object-position"); if (snapshot.display.mirrorMode !== "none" && snapshot.display.mirrorMode !== "css-compositor-x") throw new TypeError("camera projection display mirror mode is unsupported");
  if ((snapshot.stream.facingMode === "user") !== (snapshot.display.mirrorMode === "css-compositor-x")) throw new TypeError("camera projection facing and compositor mirror policy are inconsistent");
  object(snapshot.calibrationArtifact, "camera projection profile.calibrationArtifact"); exact(snapshot.calibrationArtifact, ["sha256", "byteLength"], "camera projection profile.calibrationArtifact"); hash(snapshot.calibrationArtifact.sha256, "camera projection profile.calibrationArtifact.sha256"); positiveInteger(snapshot.calibrationArtifact.byteLength, "camera projection profile.calibrationArtifact.byteLength");
  object(snapshot.authority, "camera projection profile.authority"); exact(snapshot.authority, ["class", "authorityId", "provenance"], "camera projection profile.authority"); if (snapshot.authority.class !== "production" && snapshot.authority.class !== "fixture") throw new TypeError("camera projection authority class is unsupported"); identifier(snapshot.authority.authorityId, "camera projection profile.authority.authorityId");
  if (snapshot.authority.provenance !== (snapshot.authority.class === "production" ? "physical-camera-calibration" : "synthetic-self-test")) throw new TypeError("camera projection authority and provenance are inconsistent");
  timestamp(snapshot.issuedAt, "camera projection profile.issuedAt"); timestamp(snapshot.expiresAt, "camera projection profile.expiresAt"); if (Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.issuedAt)) throw new TypeError("camera projection profile expiry must follow issuance");
  object(snapshot.signature, "camera projection profile.signature"); exact(snapshot.signature, ["algorithm", "keyId", "signatureBase64"], "camera projection profile.signature"); if (snapshot.signature.algorithm !== "ES256") throw new TypeError("camera projection signature algorithm must be ES256"); identifier(snapshot.signature.keyId, "camera projection profile.signature.keyId"); signature(snapshot.signature.signatureBase64, "camera projection profile.signature.signatureBase64");
  return freeze(snapshot as unknown as CameraProjectionProfileV1);
}
