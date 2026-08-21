import { metres, type Matrix4 } from "../../contracts/src/index.js";
import type {
  CameraCalibration,
  FaceTrackingResult,
  HeadPose,
  PoseAdapter,
  Quaternion,
} from "../../runtime/src/index.js";
import { landmarkToViewportNdc, unprojectNdcAtDepth } from "./viewport.js";

export type MediaPipePoseAdapterConfig = {
  noseAnchorLandmarkIndex?: number;
  canonicalUnitMetres?: number;
};

type Rotation3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

function normalize3(x: number, y: number, z: number): readonly [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("facial transform contains a degenerate rotation basis");
  }
  return [x / length, y / length, z / length];
}

function rotationFromColumnMajorMatrix(matrix: Matrix4): Rotation3 {
  const x = normalize3(matrix[0], matrix[1], matrix[2]);
  const yRaw = normalize3(matrix[4], matrix[5], matrix[6]);
  const projection = x[0] * yRaw[0] + x[1] * yRaw[1] + x[2] * yRaw[2];
  const y = normalize3(
    yRaw[0] - projection * x[0],
    yRaw[1] - projection * x[1],
    yRaw[2] - projection * x[2],
  );
  const z = normalize3(
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  );
  return [
    x[0], y[0], z[0],
    x[1], y[1], z[1],
    x[2], y[2], z[2],
  ];
}

export function quaternionFromRotationMatrix(rotation: Rotation3): Quaternion {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = rotation;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  const length = Math.hypot(x, y, z, w);
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

export class MediaPipePoseAdapter implements PoseAdapter {
  readonly #noseAnchorLandmarkIndex: number;
  readonly #canonicalUnitMetres: number;

  constructor(config: MediaPipePoseAdapterConfig = {}) {
    this.#noseAnchorLandmarkIndex = config.noseAnchorLandmarkIndex ?? 168;
    this.#canonicalUnitMetres = config.canonicalUnitMetres ?? 0.01;
    if (!Number.isInteger(this.#noseAnchorLandmarkIndex) || this.#noseAnchorLandmarkIndex < 0) {
      throw new RangeError("noseAnchorLandmarkIndex must be a non-negative integer");
    }
    if (!Number.isFinite(this.#canonicalUnitMetres) || this.#canonicalUnitMetres <= 0) {
      throw new RangeError("canonicalUnitMetres must be positive and finite");
    }
  }

  resolve(input: FaceTrackingResult, camera: CameraCalibration): HeadPose {
    if (input.imageSize.width !== camera.sourceSize.width || input.imageSize.height !== camera.sourceSize.height) {
      throw new Error("tracking image size must match camera calibration source size");
    }
    const anchor = input.landmarks[this.#noseAnchorLandmarkIndex];
    if (!anchor) {
      throw new Error(`nose anchor landmark ${this.#noseAnchorLandmarkIndex} is missing`);
    }
    const rawDepth = -input.facialTransform[14] * this.#canonicalUnitMetres;
    if (!Number.isFinite(rawDepth) || rawDepth <= 0) {
      throw new Error("facial transform must place the face in front of the -Z camera");
    }

    const ndc = landmarkToViewportNdc(anchor, camera);
    const position = unprojectNdcAtDepth(ndc, rawDepth, camera);
    const rawRotation = rotationFromColumnMajorMatrix(input.facialTransform);
    const rotation = quaternionFromRotationMatrix(rawRotation);

    return {
      position: {
        x: metres(position.x),
        y: metres(position.y),
        z: metres(position.z),
      },
      rotation,
      sourceConfidence: input.confidence,
    };
  }
}
