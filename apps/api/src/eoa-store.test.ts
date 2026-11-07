import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reserveArkiv, saveRequest, storedRequest } from "./eoa-store.js";

process.env.VOXY_STATE_DIR = mkdtempSync(join(tmpdir(), "voxy-store-check-"));
process.env.ARKIV_MAX_TX_COST_TGLM = "0.01";
process.env.VOXY_ARKIV_DAILY_TGLM = "0.02";
test("coordination budgets count each intent once and requests refuse conflicting IDs", () => {
  reserveArkiv("first");
  reserveArkiv("first");
  reserveArkiv("second");
  assert.throws(() => reserveArkiv("third"), /budget reached/);
  const request = {
    id: `0x${"12".repeat(32)}`,
    account: "public-account",
    controller: "public-controller",
    guardians: ["public-guardian"],
    message: { request: "first" },
    deadline: 100,
  };
  saveRequest(request);
  assert.deepEqual(storedRequest(request.id).message, request.message);
  assert.throws(
    () => saveRequest({ ...request, message: { request: "substituted" } }),
    /conflicts/,
  );
});
