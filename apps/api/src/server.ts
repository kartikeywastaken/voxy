import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { address, hex, record, stringify } from "@voxy/chain";
import {
  accountState,
  enrollAccount,
  finalizeEOA,
  prepareControllerAction,
  prepareEnrollment,
  prepareEOARecovery,
  prepareTransfer,
  sendControllerAction,
  sendTransfer,
  verifiedDeployment,
} from "./eoa-chain.js";
import { eoaConfig, eoaReader, publicNetwork } from "./eoa-config.js";
import {
  approveEOARequest,
  createRecoveryRequest,
  recoveryStatus,
  requestsFor,
  submitPublishedRecovery,
} from "./eoa-coordinator.js";
import { operationStatus } from "./eoa-sponsor.js";
import { attempt } from "./eoa-store.js";
import { sponsoredWrite } from "./queue.js";

const PORT = Number(process.env.PORT || process.env.VOXY_API_PORT || 8787);
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const origins = new Set(
  (
    process.env.VOXY_WEB_ORIGINS ||
    "http://127.0.0.1:5181,http://localhost:5181,http://127.0.0.1:5173,http://localhost:5173"
  )
    .split(",")
    .map((v) => v.trim()),
);
function send(req: IncomingMessage, res: ServerResponse, status: number, data: unknown) {
  const origin = req.headers.origin;
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin && origins.has(origin)
      ? {
          "access-control-allow-origin": origin,
          vary: "Origin",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        }
      : {}),
  });
  res.end(stringify(data));
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > 16384) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
const server = createServer(async (req, res) => {
  const respond = (status: number, data: unknown) => send(req, res, status, data);
  try {
    if (req.headers.origin && !origins.has(req.headers.origin))
      return respond(403, { error: "This web origin is not allowed" });
    if (req.method === "OPTIONS") return respond(204, {});
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const route = `${req.method} ${url.pathname}`;
    const ip = req.socket.remoteAddress || "unknown";
    attempt(`rpc:${ip}`, 120, 60);
    if (route === "GET /api/health" || route === "GET /api/eoa/config") {
      try {
        return respond(200, {
          ready: true,
          ...(await verifiedDeployment()),
          chain: publicNetwork(),
          publicCoordination: "Arkiv Rabdi",
          custody: "client-only",
        });
      } catch {
        return respond(503, {
          ready: false,
          error:
            "Recovery contracts are not deployed or the configured deployment cannot be verified. Run the deployment preflight.",
          chain: publicNetwork(),
        });
      }
    }
    if (route === "GET /api/eoa/account")
      return respond(
        200,
        await accountState(
          address(url.searchParams.get("address")),
          url.searchParams.has("controller")
            ? address(url.searchParams.get("controller"))
            : undefined,
        ),
      );
    if (route === "GET /api/eoa/native-status") {
      const hash = hex(url.searchParams.get("hash"), 32);
      const receipt = await eoaReader()
        .getTransactionReceipt({ hash })
        .catch(() => null);
      return respond(200, {
        id: hash,
        hash,
        phase: receipt ? (receipt.status === "success" ? "confirmed" : "reverted") : "submitting",
        explorer: `https://sepolia.etherscan.io/tx/${hash}`,
        error: receipt?.status === "reverted" ? "The transaction reverted" : undefined,
      });
    }
    if (route === "GET /api/eoa/operation")
      return respond(200, await operationStatus(String(url.searchParams.get("id") || "")));
    if (route === "GET /api/eoa/recovery")
      return respond(200, await recoveryStatus(hex(url.searchParams.get("id"), 32)));
    if (route === "GET /api/eoa/requests")
      return respond(
        200,
        await requestsFor(
          url.searchParams.has("guardian")
            ? { guardian: address(url.searchParams.get("guardian")) }
            : { account: address(url.searchParams.get("account")) },
        ),
      );
    if (req.method !== "POST") return respond(404, { error: "Route not found" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return respond(415, { error: "JSON content type required" });
    attempt(`write:${ip}`, 30, 3600);
    const input = await body(req);
    if (route === "POST /api/eoa/enrollment/prepare")
      return respond(200, await prepareEnrollment(input));
    if (route === "POST /api/eoa/enrollment")
      return respond(200, await sponsoredWrite(() => enrollAccount(input)));
    if (route === "POST /api/eoa/recovery/prepare")
      return respond(
        200,
        await prepareEOARecovery(address(input.account), address(input.newController)),
      );
    if (route === "POST /api/eoa/recovery/request")
      return respond(200, await sponsoredWrite(() => createRecoveryRequest(input)));
    if (route === "POST /api/eoa/recovery/approve")
      return respond(
        200,
        await sponsoredWrite(() => approveEOARequest(hex(input.id, 32), hex(input.signature, 65))),
      );
    if (route === "POST /api/eoa/recovery/submit")
      return respond(200, await sponsoredWrite(() => submitPublishedRecovery(hex(input.id, 32))));
    if (route === "POST /api/eoa/recovery/finalize")
      return respond(200, await sponsoredWrite(() => finalizeEOA(address(input.account))));
    if (route === "POST /api/eoa/controller/prepare")
      return respond(200, await prepareControllerAction(input));
    if (route === "POST /api/eoa/controller")
      return respond(200, await sponsoredWrite(() => sendControllerAction(input)));
    if (route === "POST /api/eoa/transfer/prepare")
      return respond(200, await prepareTransfer(input));
    if (route === "POST /api/eoa/transfer")
      return respond(200, await sponsoredWrite(() => sendTransfer(input)));
    return respond(410, {
      error:
        "The server-custodied demo and smart-account creation routes have been removed. Use the EIP-7702 wallet flow.",
    });
  } catch (error) {
    // Provider diagnostics may contain RPC credentials; only application errors reach the client.
    const message =
      error instanceof Error && !("shortMessage" in error) && !/https?:\/\//i.test(error.message)
        ? error.message
        : "The network operation could not be verified. Keep its operation ID and retry the status check.";
    return respond(/Too many/.test(message) ? 429 : 400, { error: message.slice(0, 240) });
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.listen(PORT, HOST, () =>
  console.log(`Voxy EIP-7702 API listening on http://${HOST}:${PORT}`),
);
