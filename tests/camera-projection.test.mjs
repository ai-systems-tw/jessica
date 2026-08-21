import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Vector3 } from "three";

import { cameraProjectionProfileIdentity, canonicalJson, parseCameraProjectionProfileV1 } from "../dist/packages/contracts/src/index.js";
import {
  cameraCalibrationFromProjection, cameraDeviceBindingSha256, cameraProjectionProfileSigningPayload,
  createSyntheticFixtureCameraProjection, resolveCameraProjection, syntheticFixtureCameraCalibrationArtifactBytes, verifyCameraProjectionProfileSet,
} from "../dist/packages/runtime/src/index.js";
import { cameraViewportProjection, landmarkToViewportNdc, unprojectNdcAtDepth } from "../dist/packages/pose/src/index.js";
import { ThreeEyewearRenderer } from "../dist/packages/rendering/src/index.js";

const NOW = Date.parse("2026-01-01T01:00:00Z");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), use: "sig", alg: "ES256", key_ops: ["verify"], ext: true };
const trust = (overrides = {}) => ({ trustedKeys: { key1: { authorityId: "projection-authority", authorityClass: "production", publicJwk } }, nowEpochMs: NOW, maximumClockSkewMs: 1000, maximumProfileLifetimeMs: 172_800_000, maximumProfileAgeMs: 172_800_000, ...overrides });

async function profile(overrides = {}) {
  const deviceId = overrides.deviceId ?? "camera-a";
  const stream = { widthPx: 1280, heightPx: 720, aspectRatio: 1280 / 720, facingMode: "user", orientation: "landscape", ...overrides.stream };
  const identity = {
    schemaVersion: 1, type: "jessica.camera-projection-profile",
    binding: { scheme: "sha256-media-device-id-v1", deviceIdSha256: await cameraDeviceBindingSha256(deviceId) },
    stream, intrinsics: { fxPx: 800, fyPx: 790, cxPx: 635, cyPx: 358, ...overrides.intrinsics }, distortionModel: "none",
    display: { objectFit: "cover", objectPosition: "center", mirrorMode: "css-compositor-x" },
    calibrationArtifact: { sha256: "a".repeat(64), byteLength: 123 }, authority: { class: "production", authorityId: "projection-authority", provenance: "physical-camera-calibration" },
    issuedAt: overrides.issuedAt ?? "2026-01-01T00:00:00.000Z", expiresAt: overrides.expiresAt ?? "2026-01-02T00:00:00.000Z",
  };
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(identity)))).toString("hex");
  const unsigned = { ...identity, profileId: `cppv1_${digest}`, profileSha256: digest };
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(canonicalJson(unsigned)))).toString("base64");
  return { ...unsigned, signature: { algorithm: "ES256", keyId: "key1", signatureBase64: signature } };
}

const evidence = (overrides = {}) => ({ trackSettings: { width: 1280, height: 720, aspectRatio: 1.7777778, facingMode: "user", deviceId: "camera-a", resizeMode: "none", zoom: 1, pan: 0, tilt: 0, ...overrides.trackSettings }, videoSize: { width: 1280, height: 720, ...overrides.videoSize } });

test("strict v1 parser rejects unknown fields, accessors, prototypes, cycles, aliases, nonfinite values, and relabeling", async () => {
  const valid = await profile();
  assert.equal(parseCameraProjectionProfileV1(valid).distortionModel, "none");
  for (const mutate of [
    (v) => { v.extra = true; }, (v) => { v.intrinsics.fxPx = Infinity; }, (v) => { v.intrinsics.cxPx = 2000; },
    (v) => { v.authority.class = "fixture"; }, (v) => { v.stream.orientation = "portrait"; }, (v) => { v.display.objectPosition = "left"; },
  ]) { const value = structuredClone(valid); mutate(value); assert.throws(() => parseCameraProjectionProfileV1(value)); }
  const accessor = structuredClone(valid); let read = false; Object.defineProperty(accessor.intrinsics, "fxPx", { enumerable: true, get() { read = true; return 800; } }); assert.throws(() => parseCameraProjectionProfileV1(accessor), /data properties/); assert.equal(read, false);
  const exotic = structuredClone(valid); Object.setPrototypeOf(exotic.intrinsics, { polluted: true }); assert.throws(() => parseCameraProjectionProfileV1(exotic), /plain objects/);
  const cycle = structuredClone(valid); cycle.binding.loop = cycle; assert.throws(() => parseCameraProjectionProfileV1(cycle), /cycles or aliases/);
  const alias = structuredClone(valid); alias.intrinsics = alias.binding; assert.throws(() => parseCameraProjectionProfileV1(alias), /cycles or aliases/);
});

test("canonical digest, signature, authority, expiry, and public P-256 trust are enforced", async () => {
  const valid = await profile();
  const set = await verifyCameraProjectionProfileSet([valid], trust()); assert.equal(set.profileIds[0], valid.profileId); assert.ok(Object.isFrozen(set.profiles));
  const tampered = structuredClone(valid); tampered.intrinsics.fxPx += 1; await assert.rejects(verifyCameraProjectionProfileSet([tampered], trust()), /digest|signature/);
  await assert.rejects(verifyCameraProjectionProfileSet([valid], trust({ nowEpochMs: Date.parse(valid.expiresAt) })), /stale/);
  for (const publicJwkOverride of [{ ...publicJwk, d: "x".repeat(43) }, { ...publicJwk, crv: "P-384" }, { ...publicJwk, secret: true }]) {
    await assert.rejects(verifyCameraProjectionProfileSet([valid], trust({ trustedKeys: { key1: { authorityId: "projection-authority", authorityClass: "production", publicJwk: publicJwkOverride } } })), /public P-256|unknown|fields/);
  }
  await assert.rejects(verifyCameraProjectionProfileSet([valid], { ...trust(), extra: true }), /unknown fields/);
});

test("exact active source admission rejects mismatch, optical changes, crop-and-scale, ambiguity, and unverified sets", async () => {
  const valid = await profile(); const set = await verifyCameraProjectionProfileSet([valid], trust());
  const admitted = await resolveCameraProjection(set, evidence(), NOW); assert.equal(admitted.profileId, valid.profileId); assert.equal(admitted.productionAuthority, true);
  for (const value of [
    evidence({ trackSettings: { width: 640 }, videoSize: { width: 640 } }), evidence({ videoSize: { width: 640 } }), evidence({ trackSettings: { facingMode: undefined } }), evidence({ trackSettings: { facingMode: "environment" } }), evidence({ trackSettings: { deviceId: "other" } }), evidence({ trackSettings: { zoom: 2 } }), evidence({ trackSettings: { resizeMode: "crop-and-scale" } }), evidence({ trackSettings: { aspectRatio: 1.7 } }),
  ]) await assert.rejects(resolveCameraProjection(set, value, NOW));
  await assert.rejects(resolveCameraProjection({ profiles: set.profiles, profileIds: set.profileIds, admissionDeadlineEpochMs: set.admissionDeadlineEpochMs }, evidence(), NOW), /not verified/);
  await assert.rejects(resolveCameraProjection(set, evidence(), set.admissionDeadlineEpochMs), /no longer current/);
  const renewed = await profile({ issuedAt: "2026-01-01T00:01:00.000Z", expiresAt: "2026-01-02T00:01:00.000Z", intrinsics: { fxPx: 801 } });
  await assert.rejects(verifyCameraProjectionProfileSet([valid, renewed], trust()), /ambiguous active source tuple/);
});

test("fixture projection is visibly non-production, has truthful option-bound identity, and cannot enter production verification", async () => {
  const options = { widthPx: 640, heightPx: 480, fxPx: 500, fyPx: 510, cxPx: 300, cyPx: 240 };
  const first = await createSyntheticFixtureCameraProjection(options);
  const second = await createSyntheticFixtureCameraProjection({ widthPx: 640, heightPx: 480, fxPx: 501, fyPx: 510, cxPx: 300, cyPx: 240 });
  assert.equal(first.admission, "fixture-only"); assert.equal(first.productionAuthority, false); assert.notEqual(first.profileSha256, second.profileSha256);
  const artifactBytes = syntheticFixtureCameraCalibrationArtifactBytes(options);
  const artifactDigest = Buffer.from(await crypto.subtle.digest("SHA-256", artifactBytes)).toString("hex");
  assert.equal(first.calibrationArtifactByteLength, artifactBytes.byteLength);
  assert.equal(first.calibrationArtifactSha256, artifactDigest);
  assert.notEqual(first.calibrationArtifactSha256, "0".repeat(64));
  const fixtureWire = await profile(); fixtureWire.authority = { class: "fixture", authorityId: "fixture-only-self-test", provenance: "synthetic-self-test" };
  await assert.rejects(verifyCameraProjectionProfileSet([fixtureWire], trust()), /fixture|digest/);
});

async function rendererProjectionCase({ source, intrinsics, viewport, objectFit, landmark }) {
  const projection = await createSyntheticFixtureCameraProjection({ widthPx: source.width, heightPx: source.height, ...intrinsics, objectFit });
  const calibration = cameraCalibrationFromProjection(projection, viewport);
  assert.equal(calibration.objectFit, objectFit);
  const port = { setPixelRatio() {}, setSize() {}, render() {}, dispose() {} };
  const renderer = new ThreeEyewearRenderer({ cameraCalibration: calibration, factory: { create: () => port, loadGlb: async () => { throw new Error("unused"); } } });
  const canvas = Object.assign(new EventTarget(), { clientWidth: viewport.width, clientHeight: viewport.height, width: viewport.width, height: viewport.height });
  await renderer.initialize(canvas);
  renderer.render({ timestampSeconds: 1, pose: { position: { x: 0, y: 0, z: -0.5 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, sourceConfidence: 1 }, scale: { millimetresPerPixel: null, confidence: "low", sampleCount: 0 }, opacity: 0, cameraCalibration: calibration });
  const expected = landmarkToViewportNdc(landmark, calibration); const world = unprojectNdcAtDepth(expected, .5, calibration); const actual = new Vector3(world.x, world.y, world.z).applyMatrix4(renderer.camera.projectionMatrix);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-12); assert.ok(Math.abs(actual.y - expected.y) < 1e-12);
  const matrix = renderer.camera.projectionMatrix.clone(); renderer.resize(viewport.width, viewport.height, 2); renderer.render({ timestampSeconds: 2, pose: { position: { x: 0, y: 0, z: -0.5 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, sourceConfidence: 1 }, scale: { millimetresPerPixel: null, confidence: "low", sampleCount: 0 }, opacity: 0, cameraCalibration: calibration }); assert.deepEqual(renderer.camera.projectionMatrix.elements, matrix.elements);
  renderer.dispose(); return { calibration, expected };
}

test("source-edge rays round-trip through actual asymmetric Three matrices for cover, contain, resize, and DPR", async () => {
  const cover = await rendererProjectionCase({ source: { width: 800, height: 600 }, intrinsics: { fxPx: 700, fyPx: 650, cxPx: 410, cyPx: 285 }, viewport: { width: 400, height: 600 }, objectFit: "cover", landmark: { x: 100 / 800, y: 450 / 600 } });
  assert.deepEqual(cameraViewportProjection(cover.calibration), { scale: 1, offsetX: -200, offsetY: 0, fxViewport: 700, fyViewport: 650, cxViewport: 210, cyViewport: 285 });
  const contain = await rendererProjectionCase({ source: { width: 1920, height: 1080 }, intrinsics: { fxPx: 1000, fyPx: 900, cxPx: 960, cyPx: 540 }, viewport: { width: 1000, height: 1000 }, objectFit: "contain", landmark: { x: .5, y: 0 } });
  assert.equal(cameraViewportProjection(contain.calibration).offsetY, 218.75); assert.equal(contain.expected.y, .5625);
});

test("public-live has no FOV authority or unconditional mirror fallback", async () => {
  const [main, renderer, styles] = await Promise.all([
    readFile(new URL("../apps/try-on-web/src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../packages/rendering/src/threeEyewearRenderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps/try-on-web/public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.equal(/verticalFovDeg|\bfov\s*[:=]|\?\?\s*50/.test(`${main}\n${renderer}`), false);
  assert.match(styles, /data-projection-mirror="css-compositor-x"/);
  assert.equal(/^#try-on-canvas\s*\{[^}]*transform\s*:/m.test(styles), false);
});
