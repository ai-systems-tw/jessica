import test from "node:test";
import assert from "node:assert/strict";
import {
  OneEuroFilter,
  QuaternionOneEuroFilter,
  VectorOneEuroFilter,
  slerpQuaternion,
} from "../dist/packages/tracking/src/index.js";

test("scalar One Euro filter smooths static alternating noise", () => {
  const filter = new OneEuroFilter({ minCutoff: 0.8, beta: 0.01, derivativeCutoff: 1 });
  const raw = [10, 11, 9, 11, 9, 10.5, 9.5, 10];
  const filtered = raw.map((value, index) => filter.filter(value, index / 30));
  const rawRange = Math.max(...raw.slice(2)) - Math.min(...raw.slice(2));
  const filteredRange = Math.max(...filtered.slice(2)) - Math.min(...filtered.slice(2));
  assert.ok(filteredRange < rawRange);
});

test("vector filter maintains separate axes", () => {
  const filter = new VectorOneEuroFilter();
  const first = filter.filter({ x: 1, y: 2, z: 3 }, 0);
  const second = filter.filter({ x: 2, y: 2, z: 3 }, 1 / 30);
  assert.deepEqual(first, { x: 1, y: 2, z: 3 });
  assert.ok(second.x > 1 && second.x < 2);
  assert.ok(Math.abs(second.y - 2) < 1e-12);
  assert.ok(Math.abs(second.z - 3) < 1e-12);
});

test("timestamps must increase", () => {
  const filter = new OneEuroFilter();
  filter.filter(1, 1);
  assert.throws(() => filter.filter(2, 1), /strictly increasing/);
});

test("quaternion slerp returns a normalized midpoint", () => {
  const midpoint = slerpQuaternion(
    { x: 0, y: 0, z: 0, w: 1 },
    { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
    0.5,
  );
  assert.ok(Math.abs(Math.hypot(midpoint.x, midpoint.y, midpoint.z, midpoint.w) - 1) < 1e-12);
  assert.ok(midpoint.y > 0 && midpoint.y < Math.sin(Math.PI / 4));
});

test("quaternion One Euro filter preserves normalization", () => {
  const filter = new QuaternionOneEuroFilter();
  filter.filter({ x: 0, y: 0, z: 0, w: 1 }, 0);
  const value = filter.filter({ x: 0, y: 0.2, z: 0, w: 0.98 }, 1 / 30);
  assert.ok(Math.abs(Math.hypot(value.x, value.y, value.z, value.w) - 1) < 1e-12);
});
