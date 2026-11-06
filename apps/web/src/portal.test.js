import assert from "node:assert/strict";
import test from "node:test";
import { ASCII_RAMP, createPortalRenderer } from "./portal.js";

test("ASCII portal has stable glyphs, animated lighting, and an open center", () => {
  const render = createPortalRenderer(100, 64);
  const initial = render(0).slice();
  assert.equal(initial.length, 6400);
  assert.deepEqual(render(0), initial);
  assert.notDeepEqual(render(2), initial);
  assert.equal(initial[32 * 100 + 50], 0);
  assert.ok(initial.every((level) => level < ASCII_RAMP.length));
  assert.ok(initial.filter(Boolean).length > 1000);
  assert.notDeepEqual(render(0, 0.5, -0.5), initial);
});
