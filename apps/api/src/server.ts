import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAddress } from "viem";
import { executeRecovery, startRecovery } from "./actions.js";
import { walletState } from "./state.js";

const PORT = Number(process.env.VOXY_API_PORT || 8787);
const jsonReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, jsonReplacer);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length > 8192) throw new Error("Body too large");
  return JSON.parse(raw) as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /api/health") return send(res, 200, { ok: true });

    if (route === "GET /api/state") {
      return send(res, 200, await walletState());
    }

    if (route === "POST /api/recover/start") {
      const body = await readJson(req);
      const newKey = body.newKey;
      if (typeof newKey !== "string" || !isAddress(newKey)) {
        return send(res, 400, { error: "newKey must be an address" });
      }
      return send(res, 200, await startRecovery(newKey));
    }

    if (route === "POST /api/recover/execute") {
      return send(res, 200, await executeRecovery());
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    // Surface a readable message to the UI without leaking RPC credentials.
    const message = err instanceof Error ? err.message : "server error";
    return send(res, 500, { error: message.slice(0, 300) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`voxy api listening on http://127.0.0.1:${PORT}`);
});
