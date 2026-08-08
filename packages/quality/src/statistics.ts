function requireNonEmpty(values: readonly number[], label: string): void {
  if (values.length === 0) {
    throw new RangeError(`${label} requires at least one value`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${label} values must be finite`);
  }
}

export function mean(values: readonly number[]): number {
  requireNonEmpty(values, "mean");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  requireNonEmpty(values, "median");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] as number;
  }
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function percentile(values: readonly number[], percentileValue: number): number {
  requireNonEmpty(values, "percentile");
  if (!Number.isFinite(percentileValue) || percentileValue < 0 || percentileValue > 100) {
    throw new RangeError("percentileValue must be between 0 and 100");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) {
    return sorted[lower] as number;
  }
  return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
}

export function rootMeanSquare(values: readonly number[]): number {
  requireNonEmpty(values, "rootMeanSquare");
  return Math.sqrt(mean(values.map((value) => value * value)));
}
