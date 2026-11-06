import { readFile } from "node:fs/promises";
import { object, readRecoveryState, signDigest } from "@voxy/frame-sdk";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arkivClients, networkStatus } from "./client.js";
import { approvalProgress, publishApproval, publishRequest, readRequest } from "./coordination.js";
import { json, required, writerAccount } from "./env.js";
import { firstWrite } from "./first-write.js";
import { readApprovals, readRequests, readSnapshots } from "./read.js";
import { publishRosterSnapshot, publishSepoliaSnapshot } from "./snapshot.js";

async function inputFile(path: string | undefined) {
  if (!path) throw new Error("Supply an input JSON path");
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 131072) throw new Error("Input is too large");
  return object(JSON.parse(raw));
}

try {
  const command = process.argv[2];
  if (command === "status") {
    const account = writerAccount();
    const status = await networkStatus();
    const balance = await arkivClients().reader.getBalance({ address: account.address });
    console.log(json({ ...status, writer: account.address, balanceWei: balance, symbol: "tGLM" }));
  } else if (command === "first-write") {
    console.log(json(await firstWrite()));
  } else if (command === "request") {
    console.log(
      json(
        await publishRequest(
          writerAccount(),
          await inputFile(process.argv[3]),
          required("DEVNET_RPC_URL"),
        ),
      ),
    );
  } else if (command === "approve") {
    const requestKey = process.argv[3];
    if (!requestKey) throw new Error("Supply a request entity key");
    const account = process.env.ARKIV_APPROVER_PK
      ? privateKeyToAccount(required("ARKIV_APPROVER_PK") as Hex)
      : writerAccount();
    const request = await readRequest(requestKey);
    const state = await readRecoveryState(required("DEVNET_RPC_URL"), request.message);
    if (!state.activeGuardians.has(account.address))
      throw new Error("Configured signer is not an active guardian");
    const signature = await signDigest(account, request.message);
    console.log(
      json(
        await publishApproval(
          account,
          requestKey,
          signature,
          process.argv[4] || "",
          required("DEVNET_RPC_URL"),
        ),
      ),
    );
  } else if (command === "progress") {
    if (!process.argv[3]) throw new Error("Supply a request entity key");
    console.log(json(await approvalProgress(process.argv[3], required("DEVNET_RPC_URL"))));
  } else if (command === "snapshot-sepolia") {
    const input = await inputFile(process.argv[3]);
    if (typeof input.account !== "string" || typeof input.publisher !== "string")
      throw new Error("Supply account and publisher");
    console.log(
      json(
        await publishSepoliaSnapshot(writerAccount(), {
          account: input.account,
          publisher: input.publisher,
          rpcUrl: required("SEPOLIA_RPC_URL"),
        }),
      ),
    );
  } else if (command === "snapshot") {
    const input = await inputFile(process.argv[3]);
    if (
      typeof input.wallet !== "string" ||
      typeof input.registry !== "string" ||
      !Number.isSafeInteger(input.chainId) ||
      Number(input.chainId) <= 0
    )
      throw new Error("Supply wallet, registry and chainId");
    console.log(
      json(
        await publishRosterSnapshot(writerAccount(), {
          wallet: input.wallet,
          registry: input.registry,
          chainId: Number(input.chainId),
          rpcUrl: required("DEVNET_RPC_URL"),
        }),
      ),
    );
  } else if (command === "query") {
    const kind = process.argv[3];
    const filter = process.argv[5];
    if (!filter) throw new Error("Supply an account or request ID");
    const result =
      kind === "recovery-request" && process.argv[4] === "--account"
        ? await readRequests(filter)
        : kind === "guardian-approval" && process.argv[4] === "--request-id"
          ? await readApprovals(filter)
          : kind === "roster-snapshot" && process.argv[4] === "--account"
            ? await readSnapshots(filter)
            : undefined;
    if (!result) throw new Error("Invalid query arguments");
    console.log(json(result));
  } else
    throw new Error(
      "Supported commands: status, query, first-write, request, approve, progress, snapshot, snapshot-sepolia",
    );
} catch {
  console.error(
    "Arkiv operation failed. Check configuration, Rabdi access and signer funding. Provider diagnostics are suppressed to protect RPC credentials.",
  );
  process.exitCode = 1;
}
