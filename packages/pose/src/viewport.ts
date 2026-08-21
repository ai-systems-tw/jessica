import type { CameraCalibration, NormalizedLandmark } from "../../runtime/src/index.js";

export type NdcPoint = { x: number; y: number };

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

export function validateCameraCalibration(camera: CameraCalibration): void {
  requirePositive(camera.sourceSize.width, "source width");
  requirePositive(camera.sourceSize.height, "source height");
  requirePositive(camera.viewportSize.width, "viewport width");
  requirePositive(camera.viewportSize.height, "viewport height");
  requirePositive(camera.intrinsics.fxPx, "fxPx");
  requirePositive(camera.intrinsics.fyPx, "fyPx");
  if (!Number.isFinite(camera.intrinsics.cxPx) || camera.intrinsics.cxPx < 0 || camera.intrinsics.cxPx > camera.sourceSize.width) throw new RangeError("cxPx must be within the calibrated source width");
  if (!Number.isFinite(camera.intrinsics.cyPx) || camera.intrinsics.cyPx < 0 || camera.intrinsics.cyPx > camera.sourceSize.height) throw new RangeError("cyPx must be within the calibrated source height");
  if (camera.objectFit !== "contain" && camera.objectFit !== "cover") throw new RangeError("objectFit must be contain or cover");
  if (camera.displayMirror !== "none" && camera.displayMirror !== "css-compositor-x") throw new RangeError("displayMirror is unsupported");
}

export type CameraViewportProjection = {
  scale: number;
  offsetX: number;
  offsetY: number;
  fxViewport: number;
  fyViewport: number;
  cxViewport: number;
  cyViewport: number;
};

/** V1 intentionally fixes CSS object-position to the centered 50% 50% case. */
export function cameraViewportProjection(camera: CameraCalibration): CameraViewportProjection {
  validateCameraCalibration(camera);
  const { sourceSize, viewportSize, intrinsics } = camera;
  const scaleX = viewportSize.width / sourceSize.width;
  const scaleY = viewportSize.height / sourceSize.height;
  const scale = camera.objectFit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const offsetX = (viewportSize.width - sourceSize.width * scale) / 2;
  const offsetY = (viewportSize.height - sourceSize.height * scale) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    fxViewport: intrinsics.fxPx * scale,
    fyViewport: intrinsics.fyPx * scale,
    cxViewport: offsetX + scale * intrinsics.cxPx,
    cyViewport: offsetY + scale * intrinsics.cyPx,
  };
}

export function landmarkToViewportNdc(
  landmark: Pick<NormalizedLandmark, "x" | "y">,
  camera: CameraCalibration,
): NdcPoint {
  validateCameraCalibration(camera);
  if (![landmark.x, landmark.y].every(Number.isFinite)) {
    throw new TypeError("landmark coordinates must be finite");
  }

  const { sourceSize, viewportSize } = camera;
  const projection = cameraViewportProjection(camera);
  const sourceX = landmark.x * sourceSize.width;
  const sourceY = landmark.y * sourceSize.height;
  const viewportX = projection.offsetX + sourceX * projection.scale;
  const viewportY = projection.offsetY + sourceY * projection.scale;

  return {
    x: (viewportX / viewportSize.width) * 2 - 1,
    y: 1 - (viewportY / viewportSize.height) * 2,
  };
}

export function unprojectNdcAtDepth(
  ndc: NdcPoint,
  depthMetres: number,
  camera: CameraCalibration,
): { x: number; y: number; z: number } {
  validateCameraCalibration(camera);
  requirePositive(depthMetres, "depthMetres");
  const projection = cameraViewportProjection(camera);
  const viewportX = (ndc.x + 1) * camera.viewportSize.width / 2;
  const viewportY = (1 - ndc.y) * camera.viewportSize.height / 2;
  const displayedSourceX = (viewportX - projection.offsetX) / projection.scale;
  const sourceX = displayedSourceX;
  const sourceY = (viewportY - projection.offsetY) / projection.scale;
  return {
    x: ((sourceX - camera.intrinsics.cxPx) / camera.intrinsics.fxPx) * depthMetres,
    y: -((sourceY - camera.intrinsics.cyPx) / camera.intrinsics.fyPx) * depthMetres,
    z: -depthMetres,
  };
}

export function millimetresPerViewportPixelAtDepth(depthMetres: number, camera: CameraCalibration): number {
  requirePositive(depthMetres, "depthMetres");
  const projection = cameraViewportProjection(camera);
  return depthMetres * 1_000 / projection.fxViewport;
}
