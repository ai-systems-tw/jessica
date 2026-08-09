import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type {
  EyewearRenderer,
  RenderFrame,
  RuntimeAsset,
} from "../../runtime/src/index.js";
import { DepthOnlyFaceMesh } from "./depthOnlyFaceMesh.js";

type MaterialState = { material: Material; opacity: number; transparent: boolean };

export interface ThreeRendererPort {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}

export interface ThreeRendererFactory {
  create(canvas: HTMLCanvasElement): ThreeRendererPort;
  loadGlb(url: string): Promise<Object3D>;
}

export type ThreeEyewearRendererConfig = {
  verticalFovDeg?: number;
  nearMetres?: number;
  farMetres?: number;
  maximumDevicePixelRatio?: number;
  minimumScaleCorrection?: number;
  maximumScaleCorrection?: number;
  faceLandmarkCount?: number;
  faceTriangleIndices?: Uint16Array | Uint32Array;
  factory?: ThreeRendererFactory;
  onContextLost?: () => void;
  onContextRestored?: () => void;
};

const defaultFactory: ThreeRendererFactory = {
  create: (canvas) => {
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(new Color(0x000000), 0);
    return renderer;
  },
  loadGlb: async (url) => {
    const result = await new GLTFLoader().loadAsync(url);
    return result.scene;
  },
};

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function materialsIn(root: Object3D): MaterialState[] {
  const states: MaterialState[] = [];
  root.traverse((object) => {
    const material = (object as Mesh).material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) {
      states.push({ material: item, opacity: item.opacity, transparent: item.transparent });
    }
  });
  return states;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(item)) {
        if (value && typeof value === "object" && "isTexture" in value) {
          (value as Texture).dispose();
        }
      }
      item.dispose();
    }
  });
}

export class ThreeEyewearRenderer implements EyewearRenderer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly poseRoot = new Object3D();
  readonly scaleRoot = new Object3D();
  readonly attachmentRoot = new Object3D();
  readonly #config: Required<Omit<ThreeEyewearRendererConfig, "factory" | "faceTriangleIndices" | "onContextLost" | "onContextRestored">>;
  readonly #factory: ThreeRendererFactory;
  readonly #occlusion: DepthOnlyFaceMesh | null;
  readonly #onContextLost: (() => void) | undefined;
  readonly #onContextRestored: (() => void) | undefined;
  #renderer: ThreeRendererPort | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #assetRoot: Object3D | null = null;
  #materials: MaterialState[] = [];
  #resizeObserver: ResizeObserver | null = null;
  #loadGeneration = 0;
  #viewportHeight = 1;
  #contextLost = false;
  readonly #handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.#contextLost = true;
    if (this.#assetRoot) this.#assetRoot.visible = false;
    this.#occlusion?.hide();
    this.#onContextLost?.();
  };
  readonly #handleContextRestored = (): void => {
    this.#contextLost = false;
    this.#onContextRestored?.();
  };

  constructor(config: ThreeEyewearRendererConfig = {}) {
    this.#config = {
      verticalFovDeg: config.verticalFovDeg ?? 50,
      nearMetres: config.nearMetres ?? 0.01,
      farMetres: config.farMetres ?? 10,
      maximumDevicePixelRatio: config.maximumDevicePixelRatio ?? 2,
      minimumScaleCorrection: config.minimumScaleCorrection ?? 0.65,
      maximumScaleCorrection: config.maximumScaleCorrection ?? 1.5,
      faceLandmarkCount: config.faceLandmarkCount ?? 478,
    };
    positive(this.#config.verticalFovDeg, "verticalFovDeg");
    positive(this.#config.nearMetres, "nearMetres");
    positive(this.#config.farMetres, "farMetres");
    positive(this.#config.maximumDevicePixelRatio, "maximumDevicePixelRatio");
    if (this.#config.farMetres <= this.#config.nearMetres) {
      throw new RangeError("farMetres must be greater than nearMetres");
    }
    if (this.#config.minimumScaleCorrection <= 0 || this.#config.maximumScaleCorrection < this.#config.minimumScaleCorrection) {
      throw new RangeError("scale correction bounds are invalid");
    }

    this.#factory = config.factory ?? defaultFactory;
    this.#onContextLost = config.onContextLost;
    this.#onContextRestored = config.onContextRestored;
    this.camera = new PerspectiveCamera(
      this.#config.verticalFovDeg,
      1,
      this.#config.nearMetres,
      this.#config.farMetres,
    );
    this.scene.background = null;
    this.scene.add(new HemisphereLight(new Color(0xffffff), new Color(0x334155), 1.4));
    const keyLight = new DirectionalLight(new Color(0xffffff), 2.2);
    keyLight.position.set(0.5, 1, 1);
    this.scene.add(keyLight);
    this.poseRoot.add(this.scaleRoot);
    this.scaleRoot.add(this.attachmentRoot);
    this.scene.add(this.poseRoot);
    this.#occlusion = config.faceTriangleIndices
      ? new DepthOnlyFaceMesh(this.#config.faceLandmarkCount, config.faceTriangleIndices)
      : null;
    if (this.#occlusion) this.scene.add(this.#occlusion.mesh);
  }

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (this.#renderer) return;
    this.#canvas = canvas;
    this.#contextLost = false;
    try {
      this.#renderer = this.#factory.create(canvas);
      canvas.addEventListener("webglcontextlost", this.#handleContextLost);
      canvas.addEventListener("webglcontextrestored", this.#handleContextRestored);
      this.resize(
        canvas.clientWidth || canvas.width,
        canvas.clientHeight || canvas.height,
        typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
      );
      if (typeof ResizeObserver !== "undefined") {
        this.#resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry) this.resize(entry.contentRect.width, entry.contentRect.height);
        });
        this.#resizeObserver.observe(canvas);
      }
    } catch (error) {
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = null;
      canvas.removeEventListener("webglcontextlost", this.#handleContextLost);
      canvas.removeEventListener("webglcontextrestored", this.#handleContextRestored);
      this.#renderer?.dispose();
      this.#renderer = null;
      this.#canvas = null;
      throw error;
    }
  }

  resize(width: number, height: number, pixelRatio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1): void {
    if (!this.#renderer) throw new Error("renderer must be initialized before resize");
    positive(width, "viewport width");
    positive(height, "viewport height");
    positive(pixelRatio, "device pixel ratio");
    this.#viewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.#renderer.setPixelRatio(Math.min(pixelRatio, this.#config.maximumDevicePixelRatio));
    this.#renderer.setSize(width, height, false);
  }

  async loadAsset(runtimeAsset: RuntimeAsset): Promise<void> {
    if (!this.#renderer) throw new Error("renderer must be initialized before loadAsset");
    const generation = ++this.#loadGeneration;
    const loaded = await this.#factory.loadGlb(runtimeAsset.asset.modelUrl);
    if (generation !== this.#loadGeneration) {
      disposeObject(loaded);
      return;
    }
    if (this.#assetRoot) {
      this.attachmentRoot.remove(this.#assetRoot);
      disposeObject(this.#assetRoot);
    }
    this.#assetRoot = loaded;
    this.#materials = materialsIn(loaded);
    this.attachmentRoot.matrixAutoUpdate = false;
    this.attachmentRoot.matrix.copy(new Matrix4().fromArray([...runtimeAsset.asset.attachmentMatrix]));
    this.attachmentRoot.add(loaded);
  }

  render(frame: RenderFrame): void {
    if (!this.#renderer) throw new Error("renderer must be initialized before render");
    if (!Number.isFinite(frame.opacity) || frame.opacity < 0 || frame.opacity > 1) {
      throw new RangeError("frame opacity must be between 0 and 1");
    }
    if (this.#contextLost) return;
    if (!this.#assetRoot || frame.opacity <= 0) {
      if (this.#assetRoot) this.#assetRoot.visible = false;
      this.#occlusion?.hide();
      this.#renderer.render(this.scene, this.camera);
      return;
    }
    this.#assetRoot.visible = true;
    this.poseRoot.position.set(frame.pose.position.x, frame.pose.position.y, frame.pose.position.z);
    this.poseRoot.quaternion.copy(new Quaternion(
      frame.pose.rotation.x,
      frame.pose.rotation.y,
      frame.pose.rotation.z,
      frame.pose.rotation.w,
    ));
    const depth = -frame.pose.position.z;
    if (!Number.isFinite(depth) || depth <= this.camera.near || depth >= this.camera.far) {
      this.#assetRoot.visible = false;
      this.#occlusion?.hide();
      this.#renderer.render(this.scene, this.camera);
      return;
    }
    const projectedMmPerPixel = (
      2 * depth * Math.tan((this.camera.fov * Math.PI) / 360) * 1_000
    ) / this.#viewportHeight;
    const rawCorrection = frame.scale.millimetresPerPixel === null
      ? 1
      : projectedMmPerPixel / frame.scale.millimetresPerPixel;
    const correction = Math.max(
      this.#config.minimumScaleCorrection,
      Math.min(this.#config.maximumScaleCorrection, rawCorrection),
    );
    this.scaleRoot.scale.copy(new Vector3(correction, correction, correction));
    for (const state of this.#materials) {
      state.material.opacity = state.opacity * frame.opacity;
      state.material.transparent = state.transparent || frame.opacity < 1;
      state.material.needsUpdate = true;
    }
    if (this.#occlusion && frame.faceLandmarks && frame.cameraCalibration) {
      this.#occlusion.update({
        landmarks: frame.faceLandmarks,
        camera: frame.cameraCalibration,
        headDepthMetres: depth,
        scale: frame.scale,
      });
    } else {
      this.#occlusion?.hide();
    }
    this.#renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    ++this.#loadGeneration;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (this.#assetRoot) disposeObject(this.#assetRoot);
    this.#assetRoot = null;
    this.#materials = [];
    this.#occlusion?.dispose();
    this.#renderer?.dispose();
    this.#renderer = null;
    this.#canvas?.removeEventListener("webglcontextlost", this.#handleContextLost);
    this.#canvas?.removeEventListener("webglcontextrestored", this.#handleContextRestored);
    this.#canvas = null;
    this.#contextLost = false;
  }
}
