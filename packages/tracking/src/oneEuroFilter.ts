export type OneEuroConfig = {
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
};

export const DEFAULT_TRANSLATION_FILTER: OneEuroConfig = {
  minCutoff: 1.0,
  beta: 0.04,
  derivativeCutoff: 1.0,
};

export const DEFAULT_ROTATION_FILTER: OneEuroConfig = {
  minCutoff: 1.7,
  beta: 0.025,
  derivativeCutoff: 1.0,
};

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

export function smoothingFactor(cutoff: number, deltaSeconds: number): number {
  assertPositiveFinite(cutoff, "cutoff");
  assertPositiveFinite(deltaSeconds, "deltaSeconds");
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / deltaSeconds);
}

export class LowPassFilter {
  #value: number | null = null;

  filter(value: number, alpha: number): number {
    if (!Number.isFinite(value)) {
      throw new TypeError("value must be finite");
    }
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
      throw new RangeError("alpha must be in (0, 1]");
    }

    this.#value = this.#value === null ? value : alpha * value + (1 - alpha) * this.#value;
    return this.#value;
  }

  reset(): void {
    this.#value = null;
  }

  get value(): number | null {
    return this.#value;
  }
}

export class OneEuroFilter {
  readonly #config: OneEuroConfig;
  readonly #signal = new LowPassFilter();
  readonly #derivative = new LowPassFilter();
  #previousRaw: number | null = null;
  #previousTimestamp: number | null = null;

  constructor(config: OneEuroConfig = DEFAULT_TRANSLATION_FILTER) {
    assertPositiveFinite(config.minCutoff, "minCutoff");
    assertNonNegativeFinite(config.beta, "beta");
    assertPositiveFinite(config.derivativeCutoff, "derivativeCutoff");
    this.#config = { ...config };
  }

  filter(value: number, timestampSeconds: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(timestampSeconds)) {
      throw new TypeError("value and timestampSeconds must be finite");
    }

    if (this.#previousTimestamp === null || this.#previousRaw === null) {
      this.#previousTimestamp = timestampSeconds;
      this.#previousRaw = value;
      return this.#signal.filter(value, 1);
    }

    const deltaSeconds = timestampSeconds - this.#previousTimestamp;
    if (deltaSeconds <= 0) {
      throw new RangeError("timestampSeconds must be strictly increasing");
    }

    const rawDerivative = (value - this.#previousRaw) / deltaSeconds;
    const derivativeAlpha = smoothingFactor(this.#config.derivativeCutoff, deltaSeconds);
    const filteredDerivative = this.#derivative.filter(rawDerivative, derivativeAlpha);
    const cutoff = this.#config.minCutoff + this.#config.beta * Math.abs(filteredDerivative);
    const signalAlpha = smoothingFactor(cutoff, deltaSeconds);
    const filtered = this.#signal.filter(value, signalAlpha);

    this.#previousTimestamp = timestampSeconds;
    this.#previousRaw = value;
    return filtered;
  }

  reset(): void {
    this.#signal.reset();
    this.#derivative.reset();
    this.#previousRaw = null;
    this.#previousTimestamp = null;
  }
}

export type Vector3 = { x: number; y: number; z: number };

export class VectorOneEuroFilter {
  readonly #x: OneEuroFilter;
  readonly #y: OneEuroFilter;
  readonly #z: OneEuroFilter;

  constructor(config: OneEuroConfig = DEFAULT_TRANSLATION_FILTER) {
    this.#x = new OneEuroFilter(config);
    this.#y = new OneEuroFilter(config);
    this.#z = new OneEuroFilter(config);
  }

  filter(value: Vector3, timestampSeconds: number): Vector3 {
    return {
      x: this.#x.filter(value.x, timestampSeconds),
      y: this.#y.filter(value.y, timestampSeconds),
      z: this.#z.filter(value.z, timestampSeconds),
    };
  }

  reset(): void {
    this.#x.reset();
    this.#y.reset();
    this.#z.reset();
  }
}

export type Quaternion = { x: number; y: number; z: number; w: number };

function normalizeQuaternion(value: Quaternion): Quaternion {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError("quaternion must have non-zero finite length");
  }
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

function dotQuaternion(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

function negateQuaternion(value: Quaternion): Quaternion {
  return { x: -value.x, y: -value.y, z: -value.z, w: -value.w };
}

export function slerpQuaternion(from: Quaternion, to: Quaternion, amount: number): Quaternion {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
    throw new RangeError("amount must be between 0 and 1");
  }

  const a = normalizeQuaternion(from);
  let b = normalizeQuaternion(to);
  let dot = dotQuaternion(a, b);

  if (dot < 0) {
    b = negateQuaternion(b);
    dot = -dot;
  }

  dot = Math.min(1, Math.max(-1, dot));
  if (dot > 0.9995) {
    return normalizeQuaternion({
      x: a.x + amount * (b.x - a.x),
      y: a.y + amount * (b.y - a.y),
      z: a.z + amount * (b.z - a.z),
      w: a.w + amount * (b.w - a.w),
    });
  }

  const theta0 = Math.acos(dot);
  const sinTheta0 = Math.sin(theta0);
  const theta = theta0 * amount;
  const scaleA = Math.sin(theta0 - theta) / sinTheta0;
  const scaleB = Math.sin(theta) / sinTheta0;

  return normalizeQuaternion({
    x: scaleA * a.x + scaleB * b.x,
    y: scaleA * a.y + scaleB * b.y,
    z: scaleA * a.z + scaleB * b.z,
    w: scaleA * a.w + scaleB * b.w,
  });
}

export class QuaternionOneEuroFilter {
  readonly #config: OneEuroConfig;
  readonly #angularSpeed = new LowPassFilter();
  #previousRaw: Quaternion | null = null;
  #filtered: Quaternion | null = null;
  #previousTimestamp: number | null = null;

  constructor(config: OneEuroConfig = DEFAULT_ROTATION_FILTER) {
    assertPositiveFinite(config.minCutoff, "minCutoff");
    assertNonNegativeFinite(config.beta, "beta");
    assertPositiveFinite(config.derivativeCutoff, "derivativeCutoff");
    this.#config = { ...config };
  }

  filter(value: Quaternion, timestampSeconds: number): Quaternion {
    if (!Number.isFinite(timestampSeconds)) {
      throw new TypeError("timestampSeconds must be finite");
    }
    const current = normalizeQuaternion(value);

    if (this.#previousRaw === null || this.#filtered === null || this.#previousTimestamp === null) {
      this.#previousRaw = current;
      this.#filtered = current;
      this.#previousTimestamp = timestampSeconds;
      return current;
    }

    const deltaSeconds = timestampSeconds - this.#previousTimestamp;
    if (deltaSeconds <= 0) {
      throw new RangeError("timestampSeconds must be strictly increasing");
    }

    let alignedCurrent = current;
    let rawDot = dotQuaternion(this.#previousRaw, alignedCurrent);
    if (rawDot < 0) {
      alignedCurrent = negateQuaternion(alignedCurrent);
      rawDot = -rawDot;
    }
    rawDot = Math.min(1, Math.max(-1, rawDot));
    const angularDistance = 2 * Math.acos(rawDot);
    const rawAngularSpeed = angularDistance / deltaSeconds;
    const derivativeAlpha = smoothingFactor(this.#config.derivativeCutoff, deltaSeconds);
    const filteredSpeed = this.#angularSpeed.filter(rawAngularSpeed, derivativeAlpha);
    const cutoff = this.#config.minCutoff + this.#config.beta * filteredSpeed;
    const amount = smoothingFactor(cutoff, deltaSeconds);

    this.#filtered = slerpQuaternion(this.#filtered, alignedCurrent, amount);
    this.#previousRaw = alignedCurrent;
    this.#previousTimestamp = timestampSeconds;
    return this.#filtered;
  }

  reset(): void {
    this.#angularSpeed.reset();
    this.#previousRaw = null;
    this.#filtered = null;
    this.#previousTimestamp = null;
  }
}
