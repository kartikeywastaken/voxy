import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEns } from "./recovery.js";

test("normalizes preview names and rejects invalid or unsafe input", () => {
  assert.equal(normalizeEns("  Alice.eth "), "alice.eth");
  assert.equal(normalizeEns("my-wallet.eth"), "my-wallet.eth");
  for (const value of [
    "",
    "alice",
    ".eth",
    "-alice.eth",
    "alice-.eth",
    "<script>.eth",
    "alice.eth.evil",
    "two names.eth",
  ])
    assert.equal(normalizeEns(value), null);
});
