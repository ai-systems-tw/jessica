declare const millimetresBrand: unique symbol;
declare const metresBrand: unique symbol;

export type Millimetres = number & { readonly [millimetresBrand]: "mm" };
export type Metres = number & { readonly [metresBrand]: "m" };

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

export function millimetres(value: number): Millimetres {
  requireFinite(value, "millimetres");
  return value as Millimetres;
}

export function positiveMillimetres(value: number, label = "dimension"): Millimetres {
  requireFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero millimetres`);
  }
  return value as Millimetres;
}

export function metres(value: number): Metres {
  requireFinite(value, "metres");
  return value as Metres;
}

export function mmToMetres(value: Millimetres): Metres {
  return metres(value / 1_000);
}

export function metresToMm(value: Metres): Millimetres {
  return millimetres(value * 1_000);
}
