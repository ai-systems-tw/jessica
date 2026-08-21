import assert from "node:assert/strict";
import test from "node:test";

import { CameraSession } from "../dist/apps/try-on-web/src/cameraSession.js";

class FakeTrack extends EventTarget {
  stopped = 0;
  readyState = "live";

  stop() { this.stopped += 1; }
  getSettings() { return { width: 1280, height: 720 }; }
}

function stream() {
  const track = new FakeTrack();
  return {
    track,
    value: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    },
  };
}

function video() {
  return {
    autoplay: false,
    muted: false,
    playsInline: false,
    srcObject: null,
    playCalls: 0,
    pauseCalls: 0,
    async play() { this.playCalls += 1; },
    pause() { this.pauseCalls += 1; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("camera session maps permission denial and unsupported environments", async () => {
  const connected = stream();
  let attempts = 0;
  const denied = new CameraSession({
    getUserMedia: async () => {
      if (attempts++ === 0) throw new DOMException("denied", "NotAllowedError");
      return connected.value;
    },
  });
  assert.equal((await denied.start(video())).state, "permission-denied");
  assert.equal(denied.status.errorName, "NotAllowedError");
  assert.equal((await denied.start(video())).state, "active");

  const unsupported = new CameraSession();
  assert.equal((await unsupported.start(video())).state, "unsupported");
});

test("an already-ended track never becomes an active camera session", async () => {
  const connected = stream();
  connected.track.readyState = "ended";
  const target = video();
  const session = new CameraSession({ getUserMedia: async () => connected.value });
  const result = await session.start(target);
  assert.equal(result.state, "stopped");
  assert.equal(session.status.state, "stopped");
  assert.equal(connected.track.stopped, 1);
  assert.equal(target.srcObject, null);
});

test("camera restart and stop release tracks and clear the video", async () => {
  const first = stream();
  const second = stream();
  const available = [first.value, second.value];
  const session = new CameraSession({ getUserMedia: async () => available.shift() });
  const target = video();

  assert.equal((await session.start(target)).state, "active");
  assert.equal(target.srcObject, first.value);
  assert.equal((await session.start(target)).state, "active");
  assert.equal(first.track.stopped, 1);
  assert.equal(target.srcObject, second.value);

  session.stop(target);
  assert.equal(second.track.stopped, 1);
  assert.equal(target.srcObject, null);
  assert.equal(session.status.state, "stopped");
});

test("a stale camera request cannot reactivate a stopped or newer session", async () => {
  const pending = deferred();
  const stale = stream();
  const current = stream();
  let calls = 0;
  const session = new CameraSession({
    getUserMedia: () => calls++ === 0 ? pending.promise : Promise.resolve(current.value),
  });
  const firstVideo = video();
  const secondVideo = video();

  const firstStart = session.start(firstVideo);
  assert.equal((await session.start(secondVideo)).state, "active");
  pending.resolve(stale.value);
  assert.equal((await firstStart).state, "active");
  assert.equal(stale.track.stopped, 1);
  assert.equal(firstVideo.srcObject, null);
  assert.equal(secondVideo.srcObject, current.value);

  const pendingStop = deferred();
  const afterStop = stream();
  const stoppedSession = new CameraSession({ getUserMedia: () => pendingStop.promise });
  const stoppedVideo = video();
  const start = stoppedSession.start(stoppedVideo);
  stoppedSession.stop(stoppedVideo);
  pendingStop.resolve(afterStop.value);
  assert.equal((await start).state, "stopped");
  assert.equal(afterStop.track.stopped, 1);
  assert.equal(stoppedVideo.srcObject, null);
});

test("camera track ending fails closed and announces that restart is required", async () => {
  const connected = stream();
  const target = video();
  const session = new CameraSession({ getUserMedia: async () => connected.value });
  await session.start(target);

  connected.track.dispatchEvent(new Event("ended"));
  assert.equal(session.status.state, "stopped");
  assert.match(session.status.message, /再開/);
  assert.equal(target.srcObject, null);
});

test("camera errors and throwing observers never leak raw details or break cleanup", async () => {
  const raw = "https://private.example/camera?token=secret /Users/private stack";
  const session = new CameraSession({ getUserMedia: async () => { throw new DOMException(raw, "AbortError"); } });
  session.subscribe(() => { throw new Error("observer failed"); });
  const result = await session.start(video());
  assert.equal(result.state, "error");
  assert.equal(result.message, "カメラを開始できませんでした。");
  assert.equal(JSON.stringify(result).includes(raw), false);
  assert.doesNotThrow(() => session.stop());
});
