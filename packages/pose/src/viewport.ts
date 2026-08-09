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
  if (!Number.isFinite(camera.verticalFovDeg) || camera.verticalFovDeg <= 0 || camera.verticalFovDeg >= 180) {
    throw new RangeError("verticalFovDeg must be between 0 and 180");
  }
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
  const scaleX = viewportSize.width / sourceSize.width;
  const scaleY = viewportSize.height / sourceSize.height;
  const displayScale = camera.objectFit === "cover"
    ? Math.max(scaleX, scaleY)
    : Math.min(scaleX, scaleY);
  const displayWidth = sourceSize.width * displayScale;
  const displayHeight = sourceSize.height * displayScale;
  const offsetX = (viewportSize.width - displayWidth) / 2;
  const offsetY = (viewportSize.height - displayHeight) / 2;
  const sourceX = (camera.mirrored ? 1 - landmark.x : landmark.x) * sourceSize.width;
  const sourceY = landmark.y * sourceSize.height;
  const viewportX = offsetX + sourceX * displayScale;
  const viewportY = offsetY + sourceY * displayScale;

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
  const halfHeight = depthMetres * Math.tan((camera.verticalFovDeg * Math.PI) / 360);
  const aspect = camera.viewportSize.width / camera.viewportSize.height;
  return {
    x: ndc.x * halfHeight * aspect,
    y: ndc.y * halfHeight,
    z: -depthMetres,
  };
}
