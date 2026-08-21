import { createHash } from "node:crypto";
import { canonicalJson } from "../dist/packages/contracts/src/index.js";
import { cameraDeviceBindingSha256 } from "../dist/packages/runtime/src/index.js";

export const projectionProfileSetUrl = "https://catalog.example/runtime/camera-projections/test-set.json";
const encoded = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function cameraProjectionFixture({ privateJwk, publicJwk, authorityId = "test-projection-authority", keyId = "test-projection-key", expiresAt = "2026-01-02T00:00:00.000Z", mutateDocument }) {
  const identity = {
    schemaVersion: 1, type: "jessica.camera-projection-profile",
    binding: { scheme: "sha256-media-device-id-v1", deviceIdSha256: await cameraDeviceBindingSha256("fixture-camera") },
    stream: { widthPx: 1280, heightPx: 720, aspectRatio: 1280 / 720, facingMode: "user", orientation: "landscape" },
    intrinsics: { fxPx: 800, fyPx: 790, cxPx: 635, cyPx: 358 }, distortionModel: "none",
    display: { objectFit: "cover", objectPosition: "center", mirrorMode: "css-compositor-x" },
    calibrationArtifact: { sha256: "c".repeat(64), byteLength: 456 }, authority: { class: "production", authorityId, provenance: "physical-camera-calibration" },
    issuedAt: "2026-01-01T00:00:00.000Z", expiresAt,
  };
  const profileSha256 = sha(Buffer.from(canonicalJson(identity)));
  const unsigned = { ...identity, profileId: `cppv1_${profileSha256}`, profileSha256 };
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, use: "sig", alg: "ES256" }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signatureBase64 = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(canonicalJson(unsigned)))).toString("base64");
  const document = { schemaVersion: 1, type: "jessica.camera-projection-profile-set", profileSetId: "test-camera-set", profileSetVersion: 1, profiles: [{ ...unsigned, signature: { algorithm: "ES256", keyId, signatureBase64 } }] };
  mutateDocument?.(document);
  const bytes = encoded(document);
  const binding = { profileSetId: document.profileSetId, profileSetVersion: document.profileSetVersion, url: projectionProfileSetUrl, allowedOrigin: "https://catalog.example", sha256: sha(bytes), byteLength: bytes.byteLength };
  const projectionTrust = { trustedKeys: { [keyId]: { authorityId, authorityClass: "production", publicJwk: { ...publicJwk, use: "sig", alg: "ES256", key_ops: ["verify"], ext: true } } }, nowEpochMs: Date.parse("2026-01-01T00:02:00Z"), maximumClockSkewMs: 1000, maximumProfileLifetimeMs: 172800000, maximumProfileAgeMs: 172800000 };
  return { bytes, binding, projectionTrust };
}
