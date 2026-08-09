import type { AssetVersion, Matrix4, Metres } from "../../contracts/src/index.js";

export type NormalizedLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type FaceTrackingResult = {
  timestampSeconds: number;
  confidence: number;
  landmarks: readonly NormalizedLandmark[];
  facialTransform: Matrix4;
  imageSize: ImageSize;
};

export type VideoFrameInput = {
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap;
  timestampSeconds: number;
};

export interface FaceTrackingBackend {
  initialize(): Promise<void>;
  detect(frame: VideoFrameInput): Promise<FaceTrackingResult | null>;
  dispose(): Promise<void>;
}

export type CameraCalibration = {
  sourceSize: ImageSize;
  viewportSize: ImageSize;
  mirrored: boolean;
  verticalFovDeg: number;
  objectFit: "contain" | "cover";
};

export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type Vector3Metres = {
  x: Metres;
  y: Metres;
  z: Metres;
};

export type HeadPose = {
  position: Vector3Metres;
  rotation: Quaternion;
  sourceConfidence: number;
};

export interface PoseAdapter {
  resolve(input: FaceTrackingResult, camera: CameraCalibration): HeadPose;
}

export type ScaleObservation = {
  timestampSeconds: number;
  leftIrisDiameterPx?: number;
  rightIrisDiameterPx?: number;
  interPupilDistancePx?: number;
  faceWidthPx?: number;
};

export type ScaleEstimate = {
  millimetresPerPixel: number | null;
  confidence: "low" | "medium" | "high";
  sampleCount: number;
  reason?: string;
};

export interface ScaleResolver {
  update(observation: ScaleObservation): ScaleEstimate;
  setManualOverride(millimetresPerPixel: number | null): void;
  reset(): void;
}

export type RuntimeAsset = {
  asset: AssetVersion;
};

export type RenderFrame = {
  timestampSeconds: number;
  pose: HeadPose;
  scale: ScaleEstimate;
  opacity: number;
};

export interface EyewearRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  loadAsset(asset: RuntimeAsset): Promise<void>;
  render(frame: RenderFrame): void;
  dispose(): void;
}
