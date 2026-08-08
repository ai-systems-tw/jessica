import test from "node:test";
import assert from "node:assert/strict";
import { ConfidenceGate } from "../dist/packages/tracking/src/index.js";

const config = {
  enterThreshold: 0.8,
  exitThreshold: 0.6,
  lostThreshold: 0.2,
  acquireHoldMs: 100,
  degradeHoldMs: 80,
  lostHoldMs: 200,
  recoverHoldMs: 100,
};

test("gate requires stable confidence before rendering", () => {
  const gate = new ConfidenceGate(config);
  assert.equal(gate.start().state, "acquiring");
  assert.equal(gate.update(0.9, 0).state, "acquiring");
  assert.equal(gate.update(0.9, 50).state, "acquiring");
  const tracked = gate.update(0.9, 100);
  assert.equal(tracked.state, "tracking");
  assert.equal(tracked.shouldRender, true);
});

test("gate degrades and then fails closed", () => {
  const gate = new ConfidenceGate(config);
  gate.start();
  gate.update(0.9, 0);
  gate.update(0.9, 100);
  gate.update(0.5, 120);
  assert.equal(gate.update(0.5, 200).state, "degraded");
  assert.equal(gate.update(0.1, 250).state, "degraded");
  const lost = gate.update(0.1, 450);
  assert.equal(lost.state, "lost");
  assert.equal(lost.shouldRender, false);
  assert.equal(lost.shouldPromptUser, true);
});

test("short confidence dip does not leave tracking", () => {
  const gate = new ConfidenceGate(config);
  gate.start();
  gate.update(0.9, 0);
  gate.update(0.9, 100);
  gate.update(0.5, 130);
  assert.equal(gate.update(0.9, 170).state, "tracking");
});
