import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseRequestRow, readRequests } from "@voxy/arkiv";
import { address, RecoveryValidationError, readRecoveryState } from "@voxy/frame-sdk";

export type OwnerAlert = {
  kind: "recovery-request";
  wallet: string;
  newKey: string;
  requestId: string;
  entityKey: string;
  digest: string;
  deadline: string;
  arkivBlock: string;
  devnetBlock: string;
};

export type WatchStatus = {
  kind: "watch-status";
  healthy: boolean;
  complete: boolean;
  invalid: number;
  arkivBlock?: string;
  message?: string;
};

/** Serial fresh-state polling catches native expiry without relying on historical event replay. */
export async function watchOwner(options: {
  wallet: string;
  devnetRpcUrl: string;
  signal: AbortSignal;
  onAlert: (alert: OwnerAlert) => Promise<void>;
  onStatus: (status: WatchStatus) => void;
  intervalMs?: number;
  stateDirectory?: string;
}) {
  const wallet = address(options.wallet);
  const intervalMs = options.intervalMs ?? 5_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000)
    throw new Error("Polling interval must be at least 1000ms");
  const directory = resolve(
    options.stateDirectory || fileURLToPath(new URL("../../../.voxy/watchers/", import.meta.url)),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const delivered = resolve(directory, `${wallet.toLowerCase()}.jsonl`);
  const prior = await readFile(delivered, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const seen = new Set(
    prior
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const key: unknown = JSON.parse(line);
        if (typeof key !== "string" || !/^0x[0-9a-f]{64}$/i.test(key))
          throw new Error("Invalid watcher journal; reconcile it");
        return key;
      }),
  );
  while (!options.signal.aborted) {
    try {
      const page = await readRequests(wallet);
      let invalid = page.skipped;
      const complete = page.entities.length + page.skipped < 100;
      for (const row of page.entities) {
        if (options.signal.aborted) return;
        if (seen.has(row.$key)) continue;
        let request: ReturnType<typeof parseRequestRow>;
        try {
          request = parseRequestRow(row);
          if (request.message.wallet !== wallet || request.expiresAt <= page.blockNumber)
            throw new Error("Invalid request");
        } catch {
          invalid++;
          continue;
        }
        let devnetBlock: bigint;
        try {
          devnetBlock = (await readRecoveryState(options.devnetRpcUrl, request.message))
            .blockNumber;
        } catch (error) {
          if (error instanceof RecoveryValidationError) {
            invalid++;
            continue;
          }
          throw error;
        }
        if (options.signal.aborted) return;
        await options.onAlert({
          kind: "recovery-request",
          wallet,
          newKey: request.message.newKey,
          requestId: request.message.requestId,
          entityKey: request.entityKey,
          digest: request.digest,
          deadline: request.message.deadline.toString(),
          arkivBlock: page.blockNumber.toString(),
          devnetBlock: devnetBlock.toString(),
        });
        // Checkpoint after delivery. A crash in between may repeat an alert; it never promises exactly-once delivery.
        const journal = await open(delivered, "a", 0o600);
        try {
          await journal.writeFile(`${JSON.stringify(request.entityKey)}\n`);
          await journal.sync();
        } finally {
          await journal.close();
        }
        seen.add(request.entityKey);
      }
      if (!options.signal.aborted)
        options.onStatus({
          kind: "watch-status",
          healthy: complete,
          complete,
          invalid,
          arkivBlock: page.blockNumber.toString(),
          ...(complete ? {} : { message: "Request window full; coverage is incomplete" }),
        });
    } catch {
      if (!options.signal.aborted)
        options.onStatus({
          kind: "watch-status",
          healthy: false,
          complete: false,
          invalid: 0,
          message: "Live refresh or alert delivery failed; monitoring has a gap",
        });
    }
    try {
      await delay(intervalMs, undefined, { signal: options.signal });
    } catch {
      if (!options.signal.aborted) throw new Error("Watcher timer failed");
    }
  }
}
