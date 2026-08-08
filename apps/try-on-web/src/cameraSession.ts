export type CameraState =
  | "idle"
  | "requesting"
  | "active"
  | "permission-denied"
  | "unsupported"
  | "error"
  | "stopped";

export type CameraStatus = {
  state: CameraState;
  message: string;
  errorName?: string;
};

export type CameraStatusListener = (status: CameraStatus) => void;

function messageForError(error: unknown): CameraStatus {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        state: "permission-denied",
        message: "カメラが許可されていません。ブラウザの権限設定を確認してください。",
        errorName: error.name,
      };
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return {
        state: "unsupported",
        message: "利用できるカメラが見つかりません。",
        errorName: error.name,
      };
    }
    return {
      state: "error",
      message: `カメラを開始できませんでした: ${error.message}`,
      errorName: error.name,
    };
  }

  return {
    state: "error",
    message: "カメラを開始できませんでした。",
  };
}

export class CameraSession {
  #stream: MediaStream | null = null;
  #status: CameraStatus = { state: "idle", message: "カメラは停止しています。" };
  readonly #listeners = new Set<CameraStatusListener>();

  get status(): CameraStatus {
    return this.#status;
  }

  subscribe(listener: CameraStatusListener): () => void {
    this.#listeners.add(listener);
    listener(this.#status);
    return () => this.#listeners.delete(listener);
  }

  async start(video: HTMLVideoElement): Promise<CameraStatus> {
    this.stop();

    if (!navigator.mediaDevices?.getUserMedia) {
      return this.#setStatus({
        state: "unsupported",
        message: "このブラウザはカメラAPIに対応していません。",
      });
    }

    this.#setStatus({ state: "requesting", message: "カメラの許可を確認しています…" });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      this.#stream = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const size = settings?.width && settings.height ? ` ${settings.width}×${settings.height}` : "";

      return this.#setStatus({
        state: "active",
        message: `カメラ接続済み。${size} 追跡エンジン接続は次の実装スライスです。`,
      });
    } catch (error) {
      this.#disposeStream();
      video.srcObject = null;
      return this.#setStatus(messageForError(error));
    }
  }

  stop(video?: HTMLVideoElement): CameraStatus {
    this.#disposeStream();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    return this.#setStatus({ state: "stopped", message: "カメラを停止しました。" });
  }

  #disposeStream(): void {
    for (const track of this.#stream?.getTracks() ?? []) {
      track.stop();
    }
    this.#stream = null;
  }

  #setStatus(status: CameraStatus): CameraStatus {
    this.#status = status;
    for (const listener of this.#listeners) {
      listener(status);
    }
    return status;
  }
}
