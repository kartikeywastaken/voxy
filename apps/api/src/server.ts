import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAddress, zeroAddress } from "viem";
import { cancelRecovery, executeRecovery, startRecovery } from "./actions.js";
import { guardianConfig, resolveGuardian, setGuardians } from "./guardians.js";
import { walletState } from "./state.js";

// Cloud hosts (Render/Railway/Fly) inject PORT and need 0.0.0.0; locally we stay on loopback.
const PORT = Number(process.env.PORT || process.env.VOXY_API_PORT || 8787);
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const MAX_BODY = 8192;
// Optional shared-secret for the state-changing (fund-spending) endpoints. Unset => open, for the
// local demo. Set VOXY_API_TOKEN to require `Authorization: Bearer <token>` on POSTs.
const API_TOKEN = process.env.VOXY_API_TOKEN?.trim();

const jsonReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, jsonReplacer);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(payload);
}

function authorized(req: IncomingMessage): boolean {
  if (!API_TOKEN) return true;
  return req.headers.authorization === `Bearer ${API_TOKEN}`;
}

/** Read a JSON body with a hard running size cap (never buffers more than MAX_BODY). */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new Error("Body too large");
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method !== "GET" && req.method !== "POST") {
      return send(res, 405, { error: "method not allowed" });
    }
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /api/health") return send(res, 200, { ok: true });
    if (route === "GET /api/state") {
      const raw = url.searchParams.get("wallet")?.trim();
      let w: `0x${string}` | undefined;
      if (raw) {
        try {
          // accept a 0x… address or a name.eth (resolved on Sepolia)
          const resolved = isAddress(raw) ? raw : await resolveGuardian(raw);
          if (!resolved) return send(res, 400, { error: "wallet is empty" });
          w = resolved as `0x${string}`;
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : "bad wallet" });
        }
      }
      return send(res, 200, await walletState(w));
    }
    if (route === "GET /api/guardians") return send(res, 200, await guardianConfig());

    // --- state-changing routes (spend funds / sign) require auth when a token is configured ---
    if (route.startsWith("POST /api/recover/") || route.startsWith("POST /api/guardians/")) {
      if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    }

    if (route === "POST /api/guardians/set") {
      const body = await readJson(req);
      const guardians = body.guardians;
      if (!Array.isArray(guardians) || guardians.length !== 3) {
        return send(res, 400, { error: "guardians must be an array of 3 entries" });
      }
      const threshold = body.threshold === undefined ? undefined : Number(body.threshold);
      return send(res, 200, await setGuardians({ guardians: guardians.map(String), threshold }));
    }

    if (route === "POST /api/recover/start") {
      const body = await readJson(req);
      const newKey = body.newKey;
      if (typeof newKey !== "string" || !isAddress(newKey)) {
        return send(res, 400, { error: "newKey must be an address" });
      }
      if (newKey.toLowerCase() === zeroAddress) {
        return send(res, 400, { error: "newKey cannot be the zero address" });
      }
      return send(res, 200, await startRecovery(newKey));
    }

    if (route === "POST /api/recover/execute") {
      return send(res, 200, await executeRecovery());
    }

    if (route === "POST /api/recover/cancel") {
      return send(res, 200, await cancelRecovery());
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    // Surface a readable message without leaking RPC credentials or stack traces.
    const message = err instanceof Error ? err.message : "server error";
    return send(res, 500, { error: message.slice(0, 300) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`voxy api listening on http://${HOST}:${PORT}${API_TOKEN ? " (auth required)" : ""}`);
});
