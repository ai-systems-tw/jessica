import {
  LowVisionCaptureController,
  createLowVisionCaptureIntegration,
  type LocalStillReview,
  type LowVisionState,
} from "../../../packages/low-vision-ux/src/index.js";

type Elements = {
  capture: HTMLButtonElement;
  cancel: HTMLButtonElement;
  audio: HTMLButtonElement;
  close: HTMLButtonElement;
  retake: HTMLButtonElement;
  status: HTMLElement;
  countdown: HTMLElement;
  review: HTMLElement;
  reviewImage: HTMLImageElement;
};

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing low-vision element: ${selector}`);
  return value;
}

function captureReference(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `local-capture:${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function localStill(video: HTMLVideoElement, overlay: HTMLCanvasElement, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
  const width = video.videoWidth;
  const height = video.videoHeight;
  const overlayWidth = overlay.width;
  const overlayHeight = overlay.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8_192 || height > 8_192 || width * height > 33_554_432) throw new Error("Camera frame is unavailable");
  if (!Number.isSafeInteger(overlayWidth) || !Number.isSafeInteger(overlayHeight) || overlayWidth < 1 || overlayHeight < 1 || overlayWidth > 8_192 || overlayHeight > 8_192 || overlayWidth * overlayHeight > 33_554_432) throw new Error("Overlay frame is unavailable");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Local still compositor is unavailable");
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, width, height);
  context.restore();
  context.drawImage(overlay, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    const abort = () => reject(new DOMException("Capture cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    canvas.toBlob((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new DOMException("Capture cancelled", "AbortError"));
      else if (value) resolve(value);
      else reject(new Error("Local still encoding failed"));
    }, "image/jpeg", 0.9);
  });
  if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
  const captureRef = captureReference();
  const objectUrl = URL.createObjectURL(blob);
  let target: HTMLImageElement | null = null;
  let disposed = false;
  const review = {
    show(unknownTarget: unknown): void {
      if (disposed || !(unknownTarget instanceof HTMLImageElement)) throw new TypeError("review target must be an image element");
      target = unknownTarget;
      target.src = objectUrl;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (target?.src === objectUrl) target.removeAttribute("src");
      target = null;
      URL.revokeObjectURL(objectUrl);
    },
  };
  return { captureRef, review };
}

function audioPort(): { playCount(count: 3 | 2 | 1): Promise<void> } {
  return {
    async playCount(count): Promise<void> {
      const AudioContextType = window.AudioContext;
      if (!AudioContextType) throw new Error("Audio cues are unavailable");
      const context = new AudioContextType();
      try {
        if (context.state === "suspended") await context.resume();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = count === 1 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.13);
        await new Promise<void>((resolve) => { oscillator.onended = () => resolve(); });
      } finally {
        await context.close();
      }
    },
  };
}

function messageFor(value: LowVisionState): string {
  switch (value.phase) {
    case "unavailable": return "カメラを開始すると、静止画を撮影できます。";
    case "ready": return "準備できました。撮影すると3秒のカウントダウンが始まります。";
    case "countdown": return `${value.countdown}。そのまま正面を向いてください。`;
    case "capturing": return "撮影しています。";
    case "review": return "撮影できました。眼鏡をかけ直して結果を確認してください。";
    case "failed": return value.failure === "CAPTURE_RESULT_REJECTED" ? "安全でない撮影結果を拒否しました。もう一度お試しください。" : "撮影できませんでした。もう一度お試しください。";
    case "paused": return "画面が非表示になったため撮影を中止しました。カメラを再開してください。";
    case "closed": return "静止画撮影を終了しました。";
    case "destroyed": return "静止画撮影を終了しました。";
  }
}

export function installLowVisionCapture(options: {
  video: HTMLVideoElement;
  overlay: HTMLCanvasElement;
  emitWidgetCaptureCreated?(captureRef: string): void;
  recordCommerceCaptureOccurrence?(): void;
}): { setAvailable(available: boolean): void; pageHidden(): void; destroy(): void } {
  const elements: Elements = {
    capture: required("#capture-still"), cancel: required("#cancel-capture"), audio: required("#capture-audio"),
    close: required("#close-review"), retake: required("#retake-capture"), status: required("#capture-status"),
    countdown: required("#capture-countdown"), review: required("#still-review"), reviewImage: required("#still-result"),
  };
  const background = [...document.querySelectorAll<HTMLElement>("body > main > :not(#still-review)")];
  let previousPhase: LowVisionState["phase"] | null = null;
  let focusBeforeReview: HTMLElement | null = null;
  const setModal = (open: boolean): void => {
    for (const element of background) element.inert = open;
  };
  const render = (value: LowVisionState, review: LocalStillReview | null): void => {
    const changed = previousPhase !== value.phase;
    previousPhase = value.phase;
    elements.status.textContent = messageFor(value);
    elements.status.dataset.state = value.phase;
    elements.countdown.hidden = value.phase !== "countdown";
    elements.countdown.textContent = value.phase === "countdown" ? String(value.countdown) : "";
    elements.review.hidden = value.phase !== "review";
    elements.capture.disabled = value.phase !== "ready" && value.phase !== "failed";
    elements.cancel.disabled = value.phase !== "countdown" && value.phase !== "capturing";
    elements.audio.disabled = value.audio === "unavailable" || value.phase === "closed" || value.phase === "destroyed";
    elements.audio.setAttribute("aria-pressed", String(value.audio === "enabled"));
    elements.audio.textContent = value.audio === "enabled" ? "音声カウント: オン" : value.audio === "unavailable" ? "音声カウント: 利用不可" : "音声カウント: オフ";
    if (value.phase === "review" && review) {
      if (changed) focusBeforeReview = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setModal(true);
      try { review.show(elements.reviewImage); } catch { /* controller remains authoritative */ }
      if (changed) elements.retake.focus();
    } else {
      setModal(false);
      if (changed && previousPhase !== null && focusBeforeReview) {
        const fallback = required<HTMLButtonElement>("#start-camera");
        const target = focusBeforeReview.isConnected && !(focusBeforeReview instanceof HTMLButtonElement && focusBeforeReview.disabled) ? focusBeforeReview : fallback;
        focusBeforeReview = null;
        target.focus();
      } else if (changed && (value.phase === "ready" || value.phase === "failed")) elements.capture.focus();
    }
  };
  const controller = new LowVisionCaptureController({
    timer: { set: (delayMs, callback) => window.setTimeout(callback, delayMs), clear: (handle) => window.clearTimeout(handle as number) },
    capture: { capture: (signal) => localStill(options.video, options.overlay, signal) },
    audio: audioPort(),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    integration: createLowVisionCaptureIntegration({
      emitWidgetCaptureCreated: options.emitWidgetCaptureCreated ?? (() => undefined),
      recordCommerceCaptureOccurrence: options.recordCommerceCaptureOccurrence ?? (() => undefined),
    }),
    onState: render,
  });
  const start = () => controller.start();
  const cancel = () => controller.cancel();
  const toggleAudio = () => controller.setAudioEnabled(controller.view.audio !== "enabled");
  const retake = () => controller.retake();
  const close = () => controller.close();
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || controller.view.phase !== "review") return;
    event.preventDefault();
    controller.close();
  };
  elements.capture.addEventListener("click", start);
  elements.cancel.addEventListener("click", cancel);
  elements.audio.addEventListener("click", toggleAudio);
  elements.retake.addEventListener("click", retake);
  elements.close.addEventListener("click", close);
  document.addEventListener("keydown", keydown);
  let destroyed = false;
  return {
    setAvailable: (available) => controller.setAvailable(available),
    pageHidden: () => controller.pageHidden(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      elements.capture.removeEventListener("click", start);
      elements.cancel.removeEventListener("click", cancel);
      elements.audio.removeEventListener("click", toggleAudio);
      elements.retake.removeEventListener("click", retake);
      elements.close.removeEventListener("click", close);
      document.removeEventListener("keydown", keydown);
      setModal(false);
      controller.destroy();
    },
  };
}
