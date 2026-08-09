import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const assets = [
  {
    label: "Face Landmarker model",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    destination: new URL("../apps/try-on-web/public/runtime/mediapipe/face_landmarker.task", import.meta.url),
  },
  {
    label: "MediaPipe portrait fixture",
    url: "https://storage.googleapis.com/mediapipe-assets/portrait.jpg",
    sha256: "a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e",
    destination: new URL("../apps/try-on-web/public/runtime/fixtures/portrait.jpg", import.meta.url),
  },
];

for (const asset of assets) {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.label} download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== asset.sha256) {
    throw new Error(`${asset.label} SHA-256 mismatch: ${actualSha256}`);
  }
  await mkdir(new URL("./", asset.destination), { recursive: true });
  await writeFile(asset.destination, bytes);
  console.log(`Provisioned ${asset.label}: ${bytes.byteLength} bytes / ${actualSha256}`);
}
