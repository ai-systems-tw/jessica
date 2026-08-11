export type Vector3 = readonly [number, number, number];

export type GlbValidationOptions = {
  requiredNodes: readonly string[];
  unit: "metre";
  expectedBoundsMetres?: { min: Vector3; max: Vector3 };
  boundsToleranceMetres?: number;
};

export type ValidatedGlb = {
  json: Record<string, unknown>;
  binary: ArrayBuffer;
  actualBoundsMetres: { min: Vector3; max: Vector3 };
  reachableNodeNames: readonly string[];
  positionAccessorCount: number;
};

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
};
const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

function record(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function bytesView(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

export function readGlb(bytes: ArrayBuffer | Uint8Array): { json: Record<string, unknown>; binary: ArrayBuffer } {
  const source = bytesView(bytes);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (source.byteLength < 20) throw new Error("GLB is shorter than its header and JSON chunk");
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("GLB magic header is invalid");
  if (view.getUint32(4, true) !== 2) throw new Error("GLB version must be 2");
  if (view.getUint32(8, true) !== source.byteLength) throw new Error("GLB declared length does not match actual bytes");

  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let binary: ArrayBuffer | null = null;
  let chunkIndex = 0;
  while (offset < source.byteLength) {
    if (offset + 8 > source.byteLength) throw new Error("GLB chunk header is truncated");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 !== 0 || offset + length > source.byteLength) throw new Error("GLB chunk length is invalid");
    if (chunkIndex === 0 && type !== JSON_CHUNK) throw new Error("GLB first chunk must be JSON");
    if (type === JSON_CHUNK) {
      if (json) throw new Error("GLB contains multiple JSON chunks");
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(source.subarray(offset, offset + length)).trim());
        record(parsed, "GLB JSON chunk must contain an object");
        json = parsed;
      } catch (error) {
        if (error instanceof Error && error.message === "GLB JSON chunk must contain an object") throw error;
        throw new Error("GLB JSON chunk is invalid");
      }
    } else if (type === BIN_CHUNK) {
      if (binary) throw new Error("GLB contains multiple BIN chunks");
      binary = source.slice(offset, offset + length).buffer;
    } else {
      throw new Error("GLB contains an unsupported chunk type");
    }
    offset += length;
    chunkIndex += 1;
  }
  if (offset !== source.byteLength || !json || !binary || chunkIndex !== 2) {
    throw new Error("GLB must contain exactly one JSON and one BIN chunk");
  }
  return { json, binary };
}

function finiteVector(value: unknown, length: number, message: string): number[] {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(message);
  }
  return value as number[];
}

function accessorLayout(
  accessor: Record<string, unknown>,
  bufferViews: readonly unknown[],
  binaryLength: number,
): { count: number; componentType: number; components: number; offset: number; stride: number; elementBytes: number } {
  if (accessor.sparse !== undefined) throw new Error("GLB sparse accessors are not supported");
  if (!integer(accessor.bufferView) || !integer(accessor.count, 1)) throw new Error("GLB accessor range is invalid");
  const componentBytes = COMPONENT_BYTES[accessor.componentType as number];
  const components = TYPE_COMPONENTS[accessor.type as string];
  if (!componentBytes || !components) throw new Error("GLB accessor componentType or type is unsupported");
  const bufferView = bufferViews[accessor.bufferView];
  record(bufferView, "GLB accessor bufferView is invalid");
  if (bufferView.buffer !== 0 || !integer(bufferView.byteLength, 1)) throw new Error("GLB accessor bufferView is invalid");
  const viewOffset = bufferView.byteOffset === undefined ? 0 : bufferView.byteOffset;
  const accessorOffset = accessor.byteOffset === undefined ? 0 : accessor.byteOffset;
  const elementBytes = componentBytes * components;
  const stride = bufferView.byteStride === undefined ? elementBytes : bufferView.byteStride;
  if (!integer(viewOffset) || !integer(accessorOffset) || !integer(stride, elementBytes) || (stride as number) % componentBytes !== 0) {
    throw new Error("GLB accessor byte layout is invalid");
  }
  const endInView = (accessorOffset as number) + ((accessor.count as number) - 1) * (stride as number) + elementBytes;
  if (endInView > (bufferView.byteLength as number) || (viewOffset as number) + (bufferView.byteLength as number) > binaryLength) {
    throw new Error("GLB accessor bytes exceed bufferView or BIN chunk");
  }
  return {
    count: accessor.count as number,
    componentType: accessor.componentType as number,
    components,
    offset: (viewOffset as number) + (accessorOffset as number),
    stride: stride as number,
    elementBytes,
  };
}

function validateDocument(json: Record<string, unknown>, binary: ArrayBuffer, options: GlbValidationOptions): ValidatedGlb {
  record(json.asset, "GLB glTF asset is required");
  if (json.asset.version !== "2.0") throw new Error("GLB glTF asset.version must be 2.0");
  if (options.unit !== "metre") throw new Error("GLB validation unit must be metre");
  if (!Array.isArray(json.nodes)) throw new Error("GLB nodes must be an array");
  const nodes = json.nodes;
  const nodeHasTransform = nodes.map((candidate) => {
    record(candidate, "GLB node must be an object");
    if (candidate.translation !== undefined) finiteVector(candidate.translation, 3, "GLB node translation must contain three finite numbers");
    if (candidate.rotation !== undefined) finiteVector(candidate.rotation, 4, "GLB node rotation must contain four finite numbers");
    if (candidate.scale !== undefined) finiteVector(candidate.scale, 3, "GLB node scale must contain three finite numbers");
    if (candidate.matrix !== undefined) finiteVector(candidate.matrix, 16, "GLB node matrix must contain sixteen finite numbers");
    if (candidate.matrix !== undefined && (candidate.translation !== undefined || candidate.rotation !== undefined || candidate.scale !== undefined)) {
      throw new Error("GLB node matrix cannot be combined with translation, rotation, or scale");
    }
    return candidate.matrix !== undefined || candidate.translation !== undefined || candidate.rotation !== undefined || candidate.scale !== undefined;
  });
  if (!Array.isArray(json.scenes) || !integer(json.scene)) throw new Error("GLB active scene is required");
  const activeScene = json.scenes[json.scene];
  record(activeScene, "GLB active scene is invalid");
  if (!Array.isArray(activeScene.nodes)) throw new Error("GLB active scene nodes are invalid");

  const reachable = new Set<number>();
  const reachableMeshes = new Set<number>();
  const visitedPathStates = new Set<string>();
  const visit = (index: unknown, transformedAncestor: boolean, path: Set<number>): void => {
    if (!integer(index) || index >= nodes.length) throw new Error("GLB scene node reference is invalid");
    if (path.has(index)) throw new Error("GLB active scene node graph must not contain a cycle");
    const transformedPath = transformedAncestor || nodeHasTransform[index]!;
    const stateKey = `${index}:${transformedPath ? 1 : 0}`;
    if (visitedPathStates.has(stateKey)) return;
    visitedPathStates.add(stateKey);
    reachable.add(index);
    const node = nodes[index];
    record(node, "GLB node must be an object");
    if (node.mesh !== undefined && (!integer(node.mesh) || !Array.isArray(json.meshes) || node.mesh >= json.meshes.length)) {
      throw new Error("GLB node mesh reference is invalid");
    }
    if (integer(node.mesh)) {
      if (transformedPath) throw new Error("GLB reachable mesh nodes and mesh-affecting ancestors must not contain transforms");
      reachableMeshes.add(node.mesh);
    }
    if (node.children === undefined) return;
    if (!Array.isArray(node.children)) throw new Error("GLB node children must be an array");
    path.add(index);
    node.children.forEach((child) => visit(child, transformedPath, path));
    path.delete(index);
  };
  activeScene.nodes.forEach((node) => visit(node, false, new Set<number>()));

  const names = nodes.map((node) => {
    record(node, "GLB node must be an object");
    return node.name;
  });
  for (const required of options.requiredNodes) {
    const matches = names.flatMap((name, index) => name === required ? [index] : []);
    if (matches.length !== 1) throw new Error(`GLB required node must occur exactly once: ${required}`);
    if (!reachable.has(matches[0]!)) throw new Error(`GLB required node is not reachable from the active scene: ${required}`);
  }

  if (!Array.isArray(json.meshes) || !Array.isArray(json.accessors) || !Array.isArray(json.bufferViews) || !Array.isArray(json.buffers)) {
    throw new Error("GLB buffers, views, accessors, and meshes must be arrays");
  }
  if (json.buffers.length !== 1) throw new Error("GLB supported profile requires exactly one embedded buffer");
  const buffer = json.buffers[0];
  record(buffer, "GLB embedded buffer declaration is invalid");
  if (buffer.uri !== undefined || !integer(buffer.byteLength, 1) || buffer.byteLength > binary.byteLength) {
    throw new Error("GLB embedded buffer declaration is invalid");
  }
  for (const view of json.bufferViews) {
    record(view, "GLB bufferView must be an object");
    const offset = view.byteOffset === undefined ? 0 : view.byteOffset;
    if (view.buffer !== 0 || !integer(offset) || !integer(view.byteLength, 1) || offset + view.byteLength > binary.byteLength) {
      throw new Error("GLB bufferView exceeds the embedded BIN chunk");
    }
  }
  json.accessors.forEach((candidate) => {
    record(candidate, "GLB accessor must be an object");
    accessorLayout(candidate, json.bufferViews as unknown[], binary.byteLength);
    const components = TYPE_COMPONENTS[candidate.type as string];
    if (candidate.min !== undefined) finiteVector(candidate.min, components!, "GLB accessor bounds must contain finite numbers");
    if (candidate.max !== undefined) finiteVector(candidate.max, components!, "GLB accessor bounds must contain finite numbers");
  });

  const positionMins: number[][] = [];
  const positionMaxes: number[][] = [];
  let positionAccessorCount = 0;
  const data = new DataView(binary);
  for (const [meshIndex, meshCandidate] of json.meshes.entries()) {
    record(meshCandidate, "GLB mesh must be an object");
    if (!Array.isArray(meshCandidate.primitives) || meshCandidate.primitives.length === 0) throw new Error("GLB mesh primitives must be a non-empty array");
    for (const primitiveCandidate of meshCandidate.primitives) {
      record(primitiveCandidate, "GLB mesh primitive must be an object");
      if (primitiveCandidate.mode !== undefined && primitiveCandidate.mode !== 4) throw new Error("GLB primitive mode must be TRIANGLES");
      record(primitiveCandidate.attributes, "GLB primitive attributes are required");
      for (const accessorIndex of Object.values(primitiveCandidate.attributes)) {
        if (!integer(accessorIndex) || accessorIndex >= json.accessors.length) throw new Error("GLB primitive attribute accessor reference is invalid");
      }
      const positionIndex = primitiveCandidate.attributes.POSITION;
      if (!integer(positionIndex) || positionIndex >= json.accessors.length) throw new Error("GLB primitive POSITION accessor is required");
      const accessor = json.accessors[positionIndex];
      record(accessor, "GLB POSITION accessor is invalid");
      if (accessor.type !== "VEC3" || accessor.componentType !== 5126) throw new Error("GLB POSITION accessor must be FLOAT VEC3");
      const min = finiteVector(accessor.min, 3, "GLB POSITION bounds must contain finite numbers");
      const max = finiteVector(accessor.max, 3, "GLB POSITION bounds must contain finite numbers");
      const layout = accessorLayout(accessor, json.bufferViews as unknown[], binary.byteLength);
      if (primitiveCandidate.indices !== undefined) {
        if (!integer(primitiveCandidate.indices) || primitiveCandidate.indices >= json.accessors.length) throw new Error("GLB primitive indices accessor reference is invalid");
        const indices = json.accessors[primitiveCandidate.indices];
        record(indices, "GLB primitive indices accessor is invalid");
        if (indices.type !== "SCALAR" || ![5121, 5123, 5125].includes(indices.componentType as number)) throw new Error("GLB primitive indices accessor must be an unsigned SCALAR");
        const indexLayout = accessorLayout(indices, json.bufferViews as unknown[], binary.byteLength);
        if (indexLayout.count % 3 !== 0) throw new Error("GLB indexed TRIANGLES primitive index count must be divisible by 3");
        for (let index = 0; index < indexLayout.count; index += 1) {
          const byteOffset = indexLayout.offset + index * indexLayout.stride;
          const value = indexLayout.componentType === 5121 ? data.getUint8(byteOffset)
            : indexLayout.componentType === 5123 ? data.getUint16(byteOffset, true)
            : data.getUint32(byteOffset, true);
          if (value >= layout.count) throw new Error("GLB primitive index exceeds POSITION accessor count");
        }
      } else if (layout.count % 3 !== 0) {
        throw new Error("GLB non-indexed TRIANGLES primitive POSITION count must be divisible by 3");
      }
      const actualMin = [Infinity, Infinity, Infinity];
      const actualMax = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < layout.count; index += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = data.getFloat32(layout.offset + index * layout.stride + axis * 4, true);
          if (!Number.isFinite(value)) throw new Error("GLB POSITION contains a non-finite value");
          actualMin[axis] = Math.min(actualMin[axis]!, value);
          actualMax[axis] = Math.max(actualMax[axis]!, value);
        }
      }
      for (const axis of [0, 1, 2]) {
        if (Math.abs(actualMin[axis]! - min[axis]!) > 1e-6 || Math.abs(actualMax[axis]! - max[axis]!) > 1e-6) {
          throw new Error("GLB accessor bounds do not match POSITION bytes");
        }
        if (Math.abs(actualMin[axis]!) > 5 || Math.abs(actualMax[axis]!) > 5) throw new Error("GLB bounds are invalid for metre units");
      }
      if (reachableMeshes.has(meshIndex)) {
        positionMins.push(actualMin);
        positionMaxes.push(actualMax);
      }
      positionAccessorCount += 1;
    }
  }
  if (positionMins.length === 0) throw new Error("GLB active scene contains no reachable POSITION bounds");
  const actualMin = [0, 1, 2].map((axis) => Math.min(...positionMins.map((item) => item[axis]!))) as [number, number, number];
  const actualMax = [0, 1, 2].map((axis) => Math.max(...positionMaxes.map((item) => item[axis]!))) as [number, number, number];
  for (const axis of [0, 1, 2]) {
    if (Math.abs(actualMin[axis]!) > 5 || Math.abs(actualMax[axis]!) > 5 || actualMin[axis]! >= actualMax[axis]!) {
      throw new Error("GLB bounds are invalid for metre units");
    }
  }
  if (options.expectedBoundsMetres) {
    const tolerance = options.boundsToleranceMetres ?? 1e-6;
    for (const axis of [0, 1, 2]) {
      if (Math.abs(actualMin[axis]! - options.expectedBoundsMetres.min[axis]!) > tolerance ||
          Math.abs(actualMax[axis]! - options.expectedBoundsMetres.max[axis]!) > tolerance) {
        throw new Error("GLB POSITION bounds do not match manifest boundsMetres");
      }
    }
  }
  return {
    json,
    binary,
    actualBoundsMetres: { min: actualMin, max: actualMax },
    reachableNodeNames: [...reachable].map((index) => names[index]).filter((name): name is string => typeof name === "string"),
    positionAccessorCount,
  };
}

export function validateGlb(bytes: ArrayBuffer | Uint8Array, options: GlbValidationOptions): ValidatedGlb {
  const parsed = readGlb(bytes);
  return validateDocument(parsed.json, parsed.binary, options);
}
