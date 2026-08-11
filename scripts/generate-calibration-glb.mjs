import { mkdir, writeFile } from "node:fs/promises";

function addBox(positions, normals, center, size) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((value) => value / 2);
  const faces = [
    [[1, 0, 0], [[sx, -sy, -sz], [sx, sy, -sz], [sx, sy, sz], [sx, -sy, sz]]],
    [[-1, 0, 0], [[-sx, -sy, sz], [-sx, sy, sz], [-sx, sy, -sz], [-sx, -sy, -sz]]],
    [[0, 1, 0], [[-sx, sy, -sz], [-sx, sy, sz], [sx, sy, sz], [sx, sy, -sz]]],
    [[0, -1, 0], [[-sx, -sy, sz], [-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz]]],
    [[0, 0, 1], [[-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]]],
    [[0, 0, -1], [[sx, -sy, -sz], [-sx, -sy, -sz], [-sx, sy, -sz], [sx, sy, -sz]]],
  ];
  for (const [normal, corners] of faces) {
    for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
      const corner = corners[cornerIndex];
      positions.push(cx + corner[0], cy + corner[1], cz + corner[2]);
      normals.push(...normal);
    }
  }
}

function padded(buffer, paddingByte) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, paddingByte)]);
}

export function calibrationGlbBytes() {
  const positions = [];
  const normals = [];
  const lensWidth = 0.052;
  const lensHeight = 0.036;
  const rim = 0.003;
  const lensCenters = [-0.034, 0.034];
  for (const x of lensCenters) {
    addBox(positions, normals, [x, lensHeight / 2, 0], [lensWidth, rim, 0.004]);
    addBox(positions, normals, [x, -lensHeight / 2, 0], [lensWidth, rim, 0.004]);
    addBox(positions, normals, [x - lensWidth / 2, 0, 0], [rim, lensHeight, 0.004]);
    addBox(positions, normals, [x + lensWidth / 2, 0, 0], [rim, lensHeight, 0.004]);
  }
  addBox(positions, normals, [0, 0.003, 0], [0.016, rim, 0.004]);
  addBox(positions, normals, [-0.0615, 0.008, -0.06], [rim, rim, 0.12]);
  addBox(positions, normals, [0.0615, 0.008, -0.06], [rim, rim, 0.12]);

  const positionBytes = Buffer.from(new Float32Array(positions).buffer);
  const normalBytes = Buffer.from(new Float32Array(normals).buffer);
  const binary = padded(Buffer.concat([positionBytes, normalBytes]), 0);
  const vertexCount = positions.length / 3;
  const json = {
    asset: { version: "2.0", generator: "Jessica deterministic calibration proxy" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { mesh: 0, name: "FRAME_ROOT", children: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: "NOSE_ANCHOR" },
      { name: "LENS_LEFT" },
      { name: "LENS_RIGHT" },
      { name: "HINGE_LEFT" },
      { name: "HINGE_RIGHT" },
      { name: "TEMPLE_LEFT" },
      { name: "TEMPLE_RIGHT" },
      { name: "CALIBRATION_PROXY_NOT_J1_M" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }] }],
    materials: [{
      name: "Calibration dark acetate",
      pbrMetallicRoughness: { baseColorFactor: [0.65, 0.18, 0.04, 1], metallicFactor: 0.05, roughnessFactor: 0.32 },
    }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: normalBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: "VEC3", min: [-0.063, -0.0195, -0.12], max: [0.063, 0.0195, 0.002] },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3" },
    ],
  };
  const jsonChunk = padded(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]);
}

export async function generateCalibrationGlb(destination) {
  await mkdir(new URL("./", destination), { recursive: true });
  await writeFile(destination, calibrationGlbBytes());
}
