import { CameraSession } from "./cameraSession.js";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const video = requiredElement<HTMLVideoElement>("#camera");
const startButton = requiredElement<HTMLButtonElement>("#start-camera");
const stopButton = requiredElement<HTMLButtonElement>("#stop-camera");
const status = requiredElement<HTMLElement>("#camera-status");
const stateBadge = requiredElement<HTMLElement>("#camera-state");

const session = new CameraSession();

session.subscribe((next) => {
  status.textContent = next.message;
  stateBadge.textContent = next.state;
  stateBadge.dataset.state = next.state;
  startButton.disabled = next.state === "requesting" || next.state === "active";
  stopButton.disabled = next.state !== "active";
});

startButton.addEventListener("click", () => {
  void session.start(video);
});

stopButton.addEventListener("click", () => {
  session.stop(video);
});

window.addEventListener("pagehide", () => {
  session.stop(video);
});
