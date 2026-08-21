import type { CameraCalibration, FaceTrackingResult, NormalizedLandmark, ScaleObservation } from "../../runtime/src/index.js";

export const MEDIAPIPE_IRIS_INDICES = {
  rightHorizontal: [469, 471] as const,
  leftHorizontal: [474, 476] as const,
  pupilCentres: [468, 473] as const,
};

function distancePx(
  a: NormalizedLandmark | undefined,
  b: NormalizedLandmark | undefined,
  camera: CameraCalibration,
): number | undefined {
  if (!a || !b) return undefined;
  const du = (a.x - b.x) * camera.sourceSize.width;
  const dv = (a.y - b.y) * camera.sourceSize.height;
  // Express the calibrated angular ray distance in equivalent horizontal
  // source-x pixels so mm/pixel remains compatible with renderer fx.
  const distance = camera.intrinsics.fxPx * Math.hypot(du / camera.intrinsics.fxPx, dv / camera.intrinsics.fyPx);
  return Number.isFinite(distance) && distance > 0 ? distance : undefined;
}

export function observeIrisScale(result: FaceTrackingResult, camera: CameraCalibration): ScaleObservation {
  if (result.imageSize.width !== camera.sourceSize.width || result.imageSize.height !== camera.sourceSize.height) throw new Error("iris observation source must match admitted projection");
  const [rightA, rightB] = MEDIAPIPE_IRIS_INDICES.rightHorizontal;
  const [leftA, leftB] = MEDIAPIPE_IRIS_INDICES.leftHorizontal;
  const [rightCentre, leftCentre] = MEDIAPIPE_IRIS_INDICES.pupilCentres;
  const rightIrisDiameterPx = distancePx(result.landmarks[rightA], result.landmarks[rightB], camera);
  const leftIrisDiameterPx = distancePx(result.landmarks[leftA], result.landmarks[leftB], camera);
  const interPupilDistancePx = distancePx(
    result.landmarks[rightCentre],
    result.landmarks[leftCentre],
    camera,
  );
  return {
    timestampSeconds: result.timestampSeconds,
    ...(leftIrisDiameterPx !== undefined ? { leftIrisDiameterPx } : {}),
    ...(rightIrisDiameterPx !== undefined ? { rightIrisDiameterPx } : {}),
    ...(interPupilDistancePx !== undefined ? { interPupilDistancePx } : {}),
  };
}
