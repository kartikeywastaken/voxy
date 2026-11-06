import { watchOwner } from "./index.js";

const wallet = process.argv[2];
const devnetRpcUrl = process.env.DEVNET_RPC_URL;
if (!wallet || !devnetRpcUrl) {
  console.error("Supply a wallet address and configure DEVNET_RPC_URL.");
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    await watchOwner({
      wallet,
      devnetRpcUrl,
      signal: controller.signal,
      onAlert: async (alert) => {
        console.log(JSON.stringify(alert));
      },
      onStatus: (status) => {
        console.log(JSON.stringify(status));
      },
    });
  } catch {
    console.error("Owner watcher stopped. Check configuration and its local checkpoint journal.");
    process.exitCode = 1;
  }
}
