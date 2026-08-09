import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from "three";

import type { CameraCalibration, NormalizedLandmark, ScaleEstimate } from "../../runtime/src/index.js";
import { landmarkToViewportNdc, unprojectNdcAtDepth } from "../../pose/src/index.js";

export type FaceOcclusionUpdate = {
  landmarks: readonly NormalizedLandmark[];
  camera: CameraCalibration;
  headDepthMetres: number;
  scale: ScaleEstimate;
  depthAnchorLandmarkIndex?: number;
};

export class DepthOnlyFaceMesh {
  readonly geometry: BufferGeometry;
  readonly material: MeshBasicMaterial;
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly #positions: Float32Array;

  constructor(landmarkCount: number, triangleIndices: Uint16Array | Uint32Array) {
    if (!Number.isInteger(landmarkCount) || landmarkCount <= 0) {
      throw new RangeError("landmarkCount must be a positive integer");
    }
    if (triangleIndices.length === 0 || triangleIndices.length % 3 !== 0) {
      throw new RangeError("triangleIndices must contain complete triangles");
    }
    if ([...triangleIndices].some((index) => index >= landmarkCount)) {
      throw new RangeError("triangle index exceeds landmark count");
    }
    this.#positions = new Float32Array(landmarkCount * 3);
    const positionAttribute = new BufferAttribute(this.#positions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", positionAttribute);
    this.geometry.setIndex(new BufferAttribute(triangleIndices, 1));
    this.material = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
  }

  update(input: FaceOcclusionUpdate): void {
    if (input.landmarks.length * 3 !== this.#positions.length) {
      throw new Error("occlusion landmark count changed after initialization");
    }
    if (!Number.isFinite(input.headDepthMetres) || input.headDepthMetres <= 0) {
      throw new RangeError("headDepthMetres must be positive and finite");
    }
    const anchorIndex = input.depthAnchorLandmarkIndex ?? 168;
    const anchor = input.landmarks[anchorIndex];
    if (!anchor) throw new Error(`depth anchor landmark ${anchorIndex} is missing`);
    const depthMetresPerNormalizedX = input.scale.millimetresPerPixel === null
      ? 0
      : (input.scale.millimetresPerPixel * input.camera.sourceSize.width) / 1_000;

    for (let index = 0; index < input.landmarks.length; index += 1) {
      const landmark = input.landmarks[index]!;
      const relativeDepth = (landmark.z - anchor.z) * depthMetresPerNormalizedX;
      const depth = Math.max(0.01, input.headDepthMetres + relativeDepth);
      const ndc = landmarkToViewportNdc(landmark, input.camera);
      const world = unprojectNdcAtDepth(ndc, depth, input.camera);
      const offset = index * 3;
      this.#positions[offset] = world.x;
      this.#positions[offset + 1] = world.y;
      this.#positions[offset + 2] = world.z;
    }
    const positionAttribute = this.geometry.getAttribute("position");
    positionAttribute.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
