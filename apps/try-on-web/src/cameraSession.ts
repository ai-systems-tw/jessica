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

export type CameraSessionDependencies = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

function messageForError(error: unknown): CameraStatus {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
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
  #video: HTMLVideoElement | null = null;
  #endedTrack: MediaStreamTrack | null = null;
  #generation = 0;
  #status: CameraStatus = { state: "idle", message: "カメラは停止しています。" };
  readonly #listeners = new Set<CameraStatusListener>();
  readonly #getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  readonly #handleTrackEnded = (): void => {
    const video = this.#video;
    this.#disposeStream();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    this.#video = null;
    this.#setStatus({ state: "stopped", message: "カメラ接続が終了しました。再開してください。" });
  };

  constructor(dependencies: CameraSessionDependencies = {}) {
    this.#getUserMedia = dependencies.getUserMedia
      ?? (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : null);
  }

  get status(): CameraStatus {
    return this.#status;
  }

  subscribe(listener: CameraStatusListener): () => void {
    this.#listeners.add(listener);
    listener(this.#status);
    return () => this.#listeners.delete(listener);
  }

  async start(video: HTMLVideoElement): Promise<CameraStatus> {
    const generation = ++this.#generation;
    this.#detachVideo();
    this.#disposeStream();

    if (!this.#getUserMedia) {
      return this.#setStatus({
        state: "unsupported",
        message: "このブラウザはカメラAPIに対応していません。",
      });
    }

    this.#setStatus({ state: "requesting", message: "カメラの許可を確認しています…" });

    try {
      const stream = await this.#getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (generation !== this.#generation) {
        this.#stopTracks(stream);
        return this.#status;
      }

      this.#stream = stream;
      this.#video = video;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.#generation) {
        this.#stopTracks(stream);
        if (video.srcObject === stream) video.srcObject = null;
        return this.#status;
      }

      const track = stream.getVideoTracks()[0];
      this.#endedTrack = track ?? null;
      track?.addEventListener("ended", this.#handleTrackEnded, { once: true });
      const settings = track?.getSettings();
      const size = settings?.width && settings.height ? ` ${settings.width}×${settings.height}` : "";

      return this.#setStatus({
        state: "active",
        message: `カメラ接続済み。${size}`,
      });
    } catch (error) {
      if (generation !== this.#generation) return this.#status;
      this.#disposeStream();
      if (video.srcObject) video.srcObject = null;
      this.#video = null;
      return this.#setStatus(messageForError(error));
    }
  }

  stop(video?: HTMLVideoElement): CameraStatus {
    ++this.#generation;
    const connectedVideo = video ?? this.#video;
    this.#disposeStream();
    if (connectedVideo) {
      connectedVideo.pause();
      connectedVideo.srcObject = null;
    }
    this.#video = null;
    return this.#setStatus({ state: "stopped", message: "カメラを停止しました。" });
  }

  #detachVideo(): void {
    if (!this.#video) return;
    this.#video.pause();
    this.#video.srcObject = null;
    this.#video = null;
  }

  #disposeStream(): void {
    this.#endedTrack?.removeEventListener("ended", this.#handleTrackEnded);
    this.#endedTrack = null;
    if (this.#stream) this.#stopTracks(this.#stream);
    this.#stream = null;
  }

  #stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
  }

  #setStatus(status: CameraStatus): CameraStatus {
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
    return status;
  }
}
