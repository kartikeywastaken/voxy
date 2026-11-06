import { arkivClients, networkStatus } from "./client.js";
import { json, writerAccount } from "./env.js";
import { firstWrite } from "./first-write.js";
import { readApprovals, readRequests, readSnapshots } from "./read.js";

try {
  const command = process.argv[2];
  if (command === "status") {
    const account = writerAccount();
    const status = await networkStatus();
    const balance = await arkivClients().reader.getBalance({ address: account.address });
    console.log(json({ ...status, writer: account.address, balanceWei: balance, symbol: "tGLM" }));
  } else if (command === "first-write") {
    console.log(json(await firstWrite()));
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
  } else throw new Error("Supported commands: status, query, first-write");
} catch {
  console.error(
    "Arkiv operation failed. Check configuration, Rabdi access and signer funding. Provider diagnostics are suppressed to protect RPC credentials.",
  );
  process.exitCode = 1;
}
