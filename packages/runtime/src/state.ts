import type { TrackingState } from "../../contracts/src/index.js";

export type RuntimeLifecycleState =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "acquiring"
  | "tracking"
  | "degraded"
  | "lost"
  | "permission-denied"
  | "unsupported"
  | "error";

export type RuntimeLifecycle = {
  state: RuntimeLifecycleState;
  errorCode?: string;
};

export type RuntimeLifecycleAction =
  | { type: "RESET" }
  | { type: "CAMERA_REQUESTED" }
  | { type: "CAMERA_GRANTED" }
  | { type: "CAMERA_DENIED" }
  | { type: "UNSUPPORTED" }
  | { type: "MODEL_READY" }
  | { type: "TRACKING_UPDATED"; trackingState: TrackingState }
  | { type: "FAILED"; errorCode: string };

export const INITIAL_RUNTIME_LIFECYCLE: RuntimeLifecycle = { state: "idle" };

export function reduceRuntimeLifecycle(
  current: RuntimeLifecycle,
  action: RuntimeLifecycleAction,
): RuntimeLifecycle {
  switch (action.type) {
    case "RESET":
      return INITIAL_RUNTIME_LIFECYCLE;
    case "CAMERA_REQUESTED":
      return { state: "requesting-camera" };
    case "CAMERA_GRANTED":
      return { state: "loading-model" };
    case "CAMERA_DENIED":
      return { state: "permission-denied" };
    case "UNSUPPORTED":
      return { state: "unsupported" };
    case "MODEL_READY":
      if (current.state !== "loading-model") {
        throw new Error(`MODEL_READY is invalid from ${current.state}`);
      }
      return { state: "acquiring" };
    case "TRACKING_UPDATED":
      if (!["acquiring", "tracking", "degraded", "lost"].includes(current.state)) {
        throw new Error(`TRACKING_UPDATED is invalid from ${current.state}`);
      }
      return {
        state: action.trackingState === "idle" ? "acquiring" : action.trackingState,
      };
    case "FAILED":
      if (!action.errorCode.trim()) throw new Error("errorCode must not be blank");
      return { state: "error", errorCode: action.errorCode };
  }
}
