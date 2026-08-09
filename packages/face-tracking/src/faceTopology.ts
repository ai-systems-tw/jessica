import { FaceLandmarker } from "@mediapipe/tasks-vision";

export function mediaPipeFaceTriangleIndices(): Uint16Array {
  const connections = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  if (connections.length % 3 !== 0) {
    throw new Error("MediaPipe face tessellation is not grouped into triangle edges");
  }
  const indices = new Uint16Array(connections.length);
  for (let index = 0; index < connections.length; index += 3) {
    const first = connections[index];
    const second = connections[index + 1];
    const third = connections[index + 2];
    if (
      !first || !second || !third
      || first.end !== second.start
      || second.end !== third.start
      || third.end !== first.start
    ) {
      throw new Error(`MediaPipe face tessellation triangle is malformed at connection ${index}`);
    }
    indices[index] = first.start;
    indices[index + 1] = first.end;
    indices[index + 2] = second.end;
  }
  return indices;
}
