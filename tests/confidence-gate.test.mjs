import test from "node:test";
import assert from "node:assert/strict";
import { ConfidenceGate } from "../dist/packages/tracking/src/index.js";

const config = {
  enterThreshold: 0.8,
  exitThreshold: 0.6,
  acquireHoldMs: 100,
  degradeHoldMs: 80,
  recoverHoldMs: 100,
  falseAttachmentLimitMs: 250,
};

function trackingGate() {
  const gate = new ConfidenceGate(config);
  gate.start();
  gate.update(0.9, 0);
  assert.equal(gate.update(0.9, 100).state, "tracking");
  return gate;
}

test("gate requires stable confidence before rendering", () => {
  const gate = new ConfidenceGate(config);
  assert.equal(gate.start().state, "acquiring");
  assert.equal(gate.update(0.9, 0).state, "acquiring");
  assert.equal(gate.update(0.9, 50).state, "acquiring");
  assert.equal(gate.update(0.9, 100).shouldRender, true);
});

test("no-face and moderate-low both reach opacity zero at the exact 250ms boundary", () => {
  for (const confidence of [0, 0.4]) {
    const gate = trackingGate();
    gate.update(confidence, 120);
    const before = gate.update(confidence, 369);
    assert.equal(before.state, "degraded");
    assert.notEqual(before.opacity, 0);
    const boundary = gate.update(confidence, 370);
    assert.equal(boundary.state, "lost");
    assert.equal(boundary.opacity, 0);
    assert.equal(boundary.shouldRender, false);
  }
});

test("short confidence dip clears before degradation", () => {
  const gate = trackingGate();
  gate.update(0.5, 130);
  const recovered = gate.update(0.6, 170);
  assert.equal(recovered.state, "tracking");
  assert.equal(recovered.belowExitSinceMs, null);
  assert.equal(recovered.opacity, 1);
});

test("exit recovery in degraded state cancels the low deadline but requires enter hysteresis", () => {
  const gate = trackingGate();
  gate.update(0.5, 120);
  assert.equal(gate.update(0.5, 200).state, "degraded");
  const moderateRecovery = gate.update(0.7, 300);
  assert.equal(moderateRecovery.state, "degraded");
  assert.equal(moderateRecovery.belowExitSinceMs, null);
  assert.equal(gate.update(0.7, 600).state, "degraded");
  gate.update(0.8, 610);
  assert.equal(gate.update(0.8, 709).state, "degraded");
  assert.equal(gate.update(0.8, 710).state, "tracking");
});

test("lost state reacquires only after sustained enter confidence", () => {
  const gate = trackingGate();
  gate.update(0, 120);
  gate.update(0, 370);
  gate.update(0.8, 400);
  assert.equal(gate.update(0.7, 450).state, "lost");
  gate.update(0.8, 500);
  assert.equal(gate.update(0.8, 599).state, "lost");
  assert.equal(gate.update(0.8, 600).state, "tracking");
});

test("threshold equality and reset semantics are deterministic", () => {
  const gate = trackingGate();
  assert.equal(gate.update(0.6, 120).belowExitSinceMs, null);
  gate.update(0.59, 121);
  assert.equal(gate.reset().state, "idle");
  assert.equal(gate.start().belowExitSinceMs, null);
});
