import type { FaceTrackingResult, NormalizedLandmark, ScaleObservation } from "../../runtime/src/index.js";

export const MEDIAPIPE_IRIS_INDICES = {
  rightHorizontal: [469, 471] as const,
  leftHorizontal: [474, 476] as const,
  pupilCentres: [468, 473] as const,
};

function distancePx(
  a: NormalizedLandmark | undefined,
  b: NormalizedLandmark | undefined,
  width: number,
  height: number,
): number | undefined {
  if (!a || !b) return undefined;
  const distance = Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  return Number.isFinite(distance) && distance > 0 ? distance : undefined;
}

export function observeIrisScale(result: FaceTrackingResult): ScaleObservation {
  const { width, height } = result.imageSize;
  const [rightA, rightB] = MEDIAPIPE_IRIS_INDICES.rightHorizontal;
  const [leftA, leftB] = MEDIAPIPE_IRIS_INDICES.leftHorizontal;
  const [rightCentre, leftCentre] = MEDIAPIPE_IRIS_INDICES.pupilCentres;
  const rightIrisDiameterPx = distancePx(result.landmarks[rightA], result.landmarks[rightB], width, height);
  const leftIrisDiameterPx = distancePx(result.landmarks[leftA], result.landmarks[leftB], width, height);
  const interPupilDistancePx = distancePx(
    result.landmarks[rightCentre],
    result.landmarks[leftCentre],
    width,
    height,
  );
  return {
    timestampSeconds: result.timestampSeconds,
    ...(leftIrisDiameterPx !== undefined ? { leftIrisDiameterPx } : {}),
    ...(rightIrisDiameterPx !== undefined ? { rightIrisDiameterPx } : {}),
    ...(interPupilDistancePx !== undefined ? { interPupilDistancePx } : {}),
  };
}
