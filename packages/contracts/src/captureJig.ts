import type { ValidationIssue } from "./frame.js";

export const CAPTURE_VIEW_ROLES = ["front", "left15", "right15", "left25", "right25"] as const;
export type CaptureViewRole = (typeof CAPTURE_VIEW_ROLES)[number];
const ROLE_YAW: Record<CaptureViewRole, number> = { front: 0, left15: -15, right15: 15, left25: -25, right25: 25 };
export const CAPTURE_CHECKLIST_ITEMS = [
  "jig-clean-and-undamaged", "camera-profile-locked", "distance-and-height-verified", "lighting-and-background-verified",
  "scale-marker-visible", "caliper-zero-checked", "angle-gauge-zero-checked", "sku-and-model-identity-verified",
] as const;

export type CaptureJigProfile = {
  schemaVersion: 1;
  profileId: string;
  profileVersion: number;
  template: boolean;
  jig: { version: string; fixtureIdentity: string };
  camera: { deviceIdentity: string; profileName: string; settingsSha256: string | null; distanceMm: number | null; heightMm: number | null };
  views: Array<{ role: CaptureViewRole; targetYawDeg: number; calibratedYawDeg: number | null; yawToleranceDeg: number | null }>;
  lighting: { profileName: string; illuminanceLux: number | null; colorTemperatureK: number | null };
  background: { profileName: string; colorReference: string };
  scaleMarker: { identity: string; certifiedLengthMm: number | null };
  caliper: { identity: string; calibrationReference: string | null };
  angleGauge: { identity: string; calibrationReference: string | null };
  namingConvention: string;
  calibrationArtifact: { objectKey: string | null; sha256: string | null; byteLength: number | null; verifiedAt: string | null; actorId: string | null };
  operatorChecklist: Array<{ item: (typeof CAPTURE_CHECKLIST_ITEMS)[number]; complete: boolean }>;
  replay: { runId: string | null; operatorId: string | null; capturedAt: string | null; cameraSettingsSha256: string | null; protocolVersion: string | null };
};

export type CaptureJigReadiness = {
  specValid: boolean;
  calibrationArtifactVerified: boolean;
  physicallyCalibrated: boolean;
  runReady: boolean;
  template: boolean | null;
  specificationIssues: readonly ValidationIssue[];
  calibrationBlockers: readonly ValidationIssue[];
  runBlockers: readonly ValidationIssue[];
};
export type CaptureArtifactInspection = { sha256: string; byteLength: number };

const HASH = /^[a-f0-9]{64}$/; const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ROOT_KEYS = new Set(["schemaVersion", "profileId", "profileVersion", "template", "jig", "camera", "views", "lighting", "background", "scaleMarker", "caliper", "angleGauge", "namingConvention", "calibrationArtifact", "operatorChecklist", "replay"]);
const KEYS = {
  jig: new Set(["version", "fixtureIdentity"]), camera: new Set(["deviceIdentity", "profileName", "settingsSha256", "distanceMm", "heightMm"]),
  view: new Set(["role", "targetYawDeg", "calibratedYawDeg", "yawToleranceDeg"]), lighting: new Set(["profileName", "illuminanceLux", "colorTemperatureK"]),
  background: new Set(["profileName", "colorReference"]), marker: new Set(["identity", "certifiedLengthMm"]), instrument: new Set(["identity", "calibrationReference"]),
  artifact: new Set(["objectKey", "sha256", "byteLength", "verifiedAt", "actorId"]), checklist: new Set(["item", "complete"]),
  replay: new Set(["runId", "operatorId", "capturedAt", "cameraSettingsSha256", "protocolVersion"]),
};
function object(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function add(issues: ValidationIssue[], path: string, message: string): void { issues.push({ path, message }); }
function strict(value: Record<string, unknown>, keys: ReadonlySet<string>, path: string, issues: ValidationIssue[]): void { for (const key of Object.keys(value)) if (!keys.has(key)) add(issues, `${path}${path ? "." : ""}${key}`, "is not allowed"); }
function text(value: unknown, path: string, issues: ValidationIssue[]): boolean { if (typeof value !== "string" || !value.trim()) { add(issues, path, "must be a non-blank string"); return false; } return true; }
function nullablePositive(value: unknown, path: string, issues: ValidationIssue[]): void { if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) add(issues, path, "must be null or a positive finite number"); }
function section(root: Record<string, unknown>, name: string, keys: ReadonlySet<string>, issues: ValidationIssue[]): Record<string, unknown> | null { const result = object(root[name]); if (!result) add(issues, name, "must be an object"); else strict(result, keys, name, issues); return result; }
function nullableText(value: unknown, path: string, issues: ValidationIssue[]): void { if (value !== null) text(value, path, issues); }
function nullableHash(value: unknown, path: string, issues: ValidationIssue[]): void { if (value !== null && (typeof value !== "string" || !HASH.test(value))) add(issues, path, "must be null or a lowercase SHA-256 digest"); }
function nullableDate(value: unknown, path: string, issues: ValidationIssue[]): void { if (value !== null && (typeof value !== "string" || !ISO.test(value) || Number.isNaN(Date.parse(value)))) add(issues, path, "must be null or an ISO-8601 UTC timestamp"); }

export function validateCaptureJigProfile(input: unknown): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = []; const root = object(input); if (!root) return [{ path: "captureProfile", message: "must be an object" }];
  strict(root, ROOT_KEYS, "", issues); if (root.schemaVersion !== 1) add(issues, "schemaVersion", "must equal 1"); text(root.profileId, "profileId", issues);
  if (!Number.isInteger(root.profileVersion) || (root.profileVersion as number) < 1) add(issues, "profileVersion", "must be a positive integer"); if (typeof root.template !== "boolean") add(issues, "template", "must be boolean");
  const jig = section(root, "jig", KEYS.jig, issues); text(jig?.version, "jig.version", issues); text(jig?.fixtureIdentity, "jig.fixtureIdentity", issues);
  const camera = section(root, "camera", KEYS.camera, issues); text(camera?.deviceIdentity, "camera.deviceIdentity", issues); text(camera?.profileName, "camera.profileName", issues); nullableHash(camera?.settingsSha256, "camera.settingsSha256", issues); nullablePositive(camera?.distanceMm, "camera.distanceMm", issues); nullablePositive(camera?.heightMm, "camera.heightMm", issues);
  if (!Array.isArray(root.views)) add(issues, "views", "must be an array"); else { if (root.views.length !== CAPTURE_VIEW_ROLES.length) add(issues, "views", "must contain exactly the required front, ±15°, and ±25° roles"); const seen = new Set<string>(); for (const [index, raw] of root.views.entries()) { const path = `views.${index}`; const view = object(raw); if (!view) { add(issues, path, "must be an object"); continue; } strict(view, KEYS.view, path, issues); if (!CAPTURE_VIEW_ROLES.includes(view.role as CaptureViewRole)) add(issues, `${path}.role`, "must be an exact required view role"); else { if (seen.has(view.role as string)) add(issues, `${path}.role`, "must not duplicate a view role"); seen.add(view.role as string); if (view.targetYawDeg !== ROLE_YAW[view.role as CaptureViewRole]) add(issues, `${path}.targetYawDeg`, `must equal ${ROLE_YAW[view.role as CaptureViewRole]} for ${view.role as string}`); } if (view.calibratedYawDeg !== null && (typeof view.calibratedYawDeg !== "number" || !Number.isFinite(view.calibratedYawDeg))) add(issues, `${path}.calibratedYawDeg`, "must be null or finite"); nullablePositive(view.yawToleranceDeg, `${path}.yawToleranceDeg`, issues); } for (const role of CAPTURE_VIEW_ROLES) if (!seen.has(role)) add(issues, "views", `missing required role ${role}`); }
  const lighting = section(root, "lighting", KEYS.lighting, issues); text(lighting?.profileName, "lighting.profileName", issues); nullablePositive(lighting?.illuminanceLux, "lighting.illuminanceLux", issues); nullablePositive(lighting?.colorTemperatureK, "lighting.colorTemperatureK", issues);
  const background = section(root, "background", KEYS.background, issues); text(background?.profileName, "background.profileName", issues); text(background?.colorReference, "background.colorReference", issues);
  const marker = section(root, "scaleMarker", KEYS.marker, issues); text(marker?.identity, "scaleMarker.identity", issues); nullablePositive(marker?.certifiedLengthMm, "scaleMarker.certifiedLengthMm", issues);
  for (const name of ["caliper", "angleGauge"] as const) { const instrument = section(root, name, KEYS.instrument, issues); text(instrument?.identity, `${name}.identity`, issues); nullableText(instrument?.calibrationReference, `${name}.calibrationReference`, issues); }
  text(root.namingConvention, "namingConvention", issues);
  const artifact = section(root, "calibrationArtifact", KEYS.artifact, issues); nullableText(artifact?.objectKey, "calibrationArtifact.objectKey", issues); if (typeof artifact?.objectKey === "string" && (artifact.objectKey.startsWith("/") || artifact.objectKey.split(/[\\/]/).includes(".."))) add(issues, "calibrationArtifact.objectKey", "must be a relative traversal-free immutable key"); nullableHash(artifact?.sha256, "calibrationArtifact.sha256", issues); if (artifact?.byteLength !== null && (!Number.isInteger(artifact?.byteLength) || (artifact?.byteLength as number) <= 0)) add(issues, "calibrationArtifact.byteLength", "must be null or a positive integer actual byte count"); nullableDate(artifact?.verifiedAt, "calibrationArtifact.verifiedAt", issues); nullableText(artifact?.actorId, "calibrationArtifact.actorId", issues);
  if (!Array.isArray(root.operatorChecklist)) add(issues, "operatorChecklist", "must be an array"); else { if (root.operatorChecklist.length !== CAPTURE_CHECKLIST_ITEMS.length) add(issues, "operatorChecklist", "must contain every required item exactly once"); const seen = new Set<string>(); root.operatorChecklist.forEach((raw, index) => { const path = `operatorChecklist.${index}`; const item = object(raw); if (!item) { add(issues, path, "must be an object"); return; } strict(item, KEYS.checklist, path, issues); if (!CAPTURE_CHECKLIST_ITEMS.includes(item.item as typeof CAPTURE_CHECKLIST_ITEMS[number])) add(issues, `${path}.item`, "must be a required checklist item"); else { if (seen.has(item.item as string)) add(issues, `${path}.item`, "must not be duplicated"); seen.add(item.item as string); } if (typeof item.complete !== "boolean") add(issues, `${path}.complete`, "must be boolean"); }); for (const item of CAPTURE_CHECKLIST_ITEMS) if (!seen.has(item)) add(issues, "operatorChecklist", `missing ${item}`); }
  const replay = section(root, "replay", KEYS.replay, issues); for (const key of ["runId", "operatorId", "protocolVersion"] as const) nullableText(replay?.[key], `replay.${key}`, issues); nullableDate(replay?.capturedAt, "replay.capturedAt", issues); nullableHash(replay?.cameraSettingsSha256, "replay.cameraSettingsSha256", issues);
  return issues;
}

export function evaluateCaptureJigReadiness(input: unknown, inspection?: CaptureArtifactInspection): CaptureJigReadiness {
  const specificationIssues = validateCaptureJigProfile(input); const root = object(input); const calibrationBlockers: ValidationIssue[] = []; const runBlockers: ValidationIssue[] = [];
  const need = (condition: boolean, path: string, message: string): void => { if (!condition) calibrationBlockers.push({ path, message }); };
  const camera = object(root?.camera); const lighting = object(root?.lighting); const artifact = object(root?.calibrationArtifact); const marker = object(root?.scaleMarker); const caliper = object(root?.caliper); const gauge = object(root?.angleGauge);
  need(typeof camera?.settingsSha256 === "string" && HASH.test(camera.settingsSha256), "camera.settingsSha256", "actual locked camera profile hash is required"); need(typeof camera?.distanceMm === "number" && camera.distanceMm > 0, "camera.distanceMm", "human-calibrated distance is required"); need(typeof camera?.heightMm === "number" && camera.heightMm > 0, "camera.heightMm", "human-calibrated height is required");
  const views = Array.isArray(root?.views) ? root.views : []; for (const role of CAPTURE_VIEW_ROLES) { const view = views.map(object).find((v) => v?.role === role); need(typeof view?.calibratedYawDeg === "number" && typeof view?.yawToleranceDeg === "number" && Math.abs((view.calibratedYawDeg as number) - ROLE_YAW[role]) <= (view.yawToleranceDeg as number), `views.${role}`, "calibrated yaw and a human-established tolerance are required and must agree"); }
  need(typeof lighting?.illuminanceLux === "number" && lighting.illuminanceLux > 0, "lighting.illuminanceLux", "measured illuminance is required"); need(typeof lighting?.colorTemperatureK === "number" && lighting.colorTemperatureK > 0, "lighting.colorTemperatureK", "measured color temperature is required");
  need(typeof marker?.certifiedLengthMm === "number" && marker.certifiedLengthMm > 0, "scaleMarker.certifiedLengthMm", "certified scale length is required"); need(typeof caliper?.calibrationReference === "string" && !!caliper.calibrationReference.trim(), "caliper.calibrationReference", "calibration reference is required"); need(typeof gauge?.calibrationReference === "string" && !!gauge.calibrationReference.trim(), "angleGauge.calibrationReference", "calibration reference is required");
  need(typeof artifact?.objectKey === "string" && !!artifact.objectKey.trim(), "calibrationArtifact.objectKey", "actual calibration artifact is required"); need(typeof artifact?.sha256 === "string" && HASH.test(artifact.sha256), "calibrationArtifact.sha256", "recorded artifact hash is required"); need(Number.isInteger(artifact?.byteLength) && (artifact?.byteLength as number) > 0, "calibrationArtifact.byteLength", "recorded artifact byte count is required"); for (const key of ["verifiedAt", "actorId"] as const) need(typeof artifact?.[key] === "string" && !!artifact[key].trim(), `calibrationArtifact.${key}`, "recorded calibration provenance is required");
  const calibrationArtifactVerified = typeof inspection?.sha256 === "string" && HASH.test(inspection.sha256) && Number.isInteger(inspection.byteLength) && inspection.byteLength > 0 && inspection.sha256 === artifact?.sha256 && inspection.byteLength === artifact?.byteLength;
  need(calibrationArtifactVerified, "calibrationArtifact", "local artifact bytes must be inspected and match the recorded SHA-256 and byte count");
  const physicallyCalibrated = specificationIssues.length === 0 && calibrationBlockers.length === 0 && root?.template === false;
  if (root?.template !== false) runBlockers.push({ path: "template", message: "committed template cannot be run-ready" }); if (!physicallyCalibrated) runBlockers.push({ path: "calibration", message: "physical calibration is required" });
  const checklist = Array.isArray(root?.operatorChecklist) ? root.operatorChecklist : []; if (checklist.length !== CAPTURE_CHECKLIST_ITEMS.length || checklist.some((raw) => object(raw)?.complete !== true)) runBlockers.push({ path: "operatorChecklist", message: "every operator check must be complete" });
  const replay = object(root?.replay); for (const key of ["runId", "operatorId", "capturedAt", "cameraSettingsSha256", "protocolVersion"] as const) if (typeof replay?.[key] !== "string" || !replay[key].trim()) runBlockers.push({ path: `replay.${key}`, message: "actual replay metadata is required" }); if (replay?.cameraSettingsSha256 !== camera?.settingsSha256) runBlockers.push({ path: "replay.cameraSettingsSha256", message: "must match the calibrated camera settings hash" });
  if (typeof replay?.capturedAt === "string" && typeof artifact?.verifiedAt === "string" && Date.parse(replay.capturedAt) < Date.parse(artifact.verifiedAt)) runBlockers.push({ path: "replay.capturedAt", message: "capture run must not precede calibration verification" });
  return { specValid: specificationIssues.length === 0, calibrationArtifactVerified, physicallyCalibrated, runReady: physicallyCalibrated && runBlockers.length === 0, template: typeof root?.template === "boolean" ? root.template : null, specificationIssues, calibrationBlockers, runBlockers };
}
