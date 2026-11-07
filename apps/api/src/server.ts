import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAddress, isAddress, isHex, zeroAddress } from "viem";
import { cancelRecovery, executeRecovery, prepareRecovery, startRecovery } from "./actions.js";
import {
  authorizeGuardians,
  guardianConfig,
  guardianIntent,
  resolveGuardian,
  setGuardians,
} from "./guardians.js";
import {
  approveRecovery,
  demoApprove,
  getRequest,
  pendingForGuardian,
  requestRecovery,
} from "./coordinator.js";
import { sponsoredWrite } from "./queue.js";
import { walletState } from "./state.js";
import { createWallet } from "./wallet.js";

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
          // accept a 0x… address (any case) or a name.eth (resolved on Sepolia)
          const resolved = await resolveGuardian(raw);
          if (!resolved) return send(res, 400, { error: "wallet is empty" });
          w = resolved as `0x${string}`;
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : "bad wallet" });
        }
      }
      return send(res, 200, await walletState(w));
    }
    // --- recovery coordination hub (reads) ---
    if (route === "GET /api/recover/request") {
      const id = url.searchParams.get("id")?.trim();
      if (!id) return send(res, 400, { error: "id is required" });
      return send(res, 200, await getRequest(id));
    }
    if (route === "GET /api/recover/pending") {
      const g = url.searchParams.get("guardian")?.trim();
      if (!g || !isAddress(g, { strict: false })) return send(res, 400, { error: "guardian address required" });
      return send(res, 200, { requests: await pendingForGuardian(getAddress(g)) });
    }

    if (route === "GET /api/guardians") {
      const wallet = url.searchParams.get("wallet");
      if (wallet && !isAddress(wallet, { strict: false }))
        return send(res, 400, { error: "Invalid wallet" });
      return send(res, 200, await guardianConfig(wallet ? getAddress(wallet) : undefined));
    }

    // --- state-changing routes (spend funds / sign) require auth when a token is configured ---
    if (
      route.startsWith("POST /api/recover/") ||
      route.startsWith("POST /api/guardians/") ||
      route.startsWith("POST /api/wallet/")
    ) {
      if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    }

    if (route === "POST /api/wallet/create") {
      const body = await readJson(req);
      const owner = body.owner;
      if (typeof owner !== "string" || !isAddress(owner, { strict: false })) {
        return send(res, 400, { error: "owner must be an address" });
      }
      return send(res, 200, await sponsoredWrite(() => createWallet(owner)));
    }

    if (route === "POST /api/guardians/set" || route === "POST /api/guardians/prepare") {
      const body = await readJson(req);
      const guardians = body.guardians;
      if (!Array.isArray(guardians) || guardians.length !== 3) {
        return send(res, 400, { error: "guardians must be an array of 3 entries" });
      }
      const threshold = body.threshold === undefined ? undefined : Number(body.threshold);
      if (
        typeof body.wallet !== "string" ||
        !isAddress(body.wallet, { strict: false }) ||
        guardians.some((g) => typeof g !== "string")
      )
        return send(res, 400, { error: "wallet and guardian strings are required" });
      const wallet = getAddress(body.wallet);
      const input = { guardians: guardians as string[], threshold, wallet };
      if (route.endsWith("/prepare"))
        return send(res, 200, {
          message: await guardianIntent(wallet, input.guardians, threshold),
        });
      if (
        typeof body.message !== "string" ||
        typeof body.signature !== "string" ||
        !isHex(body.signature)
      )
        return send(res, 400, { error: "Sign the guardian change with an account owner" });
      const { message, signature } = body as { message: string; signature: `0x${string}` };
      return send(
        res,
        200,
        await sponsoredWrite(async () => {
          await authorizeGuardians({ ...input, message, signature });
          return setGuardians(input);
        }),
      );
    }

    // --- recovery coordination hub (writes) ---
    if (route === "POST /api/recover/request") {
      const body = await readJson(req);
      if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }))
        return send(res, 400, { error: "wallet is required" });
      if (typeof body.newKey !== "string" || !isAddress(body.newKey, { strict: false }))
        return send(res, 400, { error: "newKey must be an address" });
      return send(res, 200, await requestRecovery(getAddress(body.wallet), getAddress(body.newKey)));
    }
    if (route === "POST /api/recover/approve") {
      const body = await readJson(req);
      if (typeof body.id !== "string") return send(res, 400, { error: "id is required" });
      if (typeof body.signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(body.signature))
        return send(res, 400, { error: "signature must be a 65-byte guardian signature" });
      return send(
        res,
        200,
        await sponsoredWrite(() => approveRecovery(body.id as string, body.signature as `0x${string}`)),
      );
    }
    if (route === "POST /api/recover/demo-approve") {
      const body = await readJson(req);
      if (typeof body.id !== "string") return send(res, 400, { error: "id is required" });
      return send(res, 200, await sponsoredWrite(() => demoApprove(body.id as string)));
    }

    if (route === "POST /api/recover/start" || route === "POST /api/recover/prepare") {
      const body = await readJson(req);
      const newKey = body.newKey;
      if (typeof newKey !== "string" || !isAddress(newKey, { strict: false })) {
        return send(res, 400, { error: "newKey must be an address" });
      }
      if (newKey.toLowerCase() === zeroAddress) {
        return send(res, 400, { error: "newKey cannot be the zero address" });
      }
      if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }))
        return send(res, 400, { error: "wallet is required" });
      const wallet = getAddress(body.wallet);
      if (route.endsWith("/prepare"))
        return send(res, 200, await prepareRecovery(getAddress(newKey), wallet));
      if (body.request !== undefined && typeof body.request !== "string")
        return send(res, 400, { error: "request must be JSON text" });
      if (
        body.signatures !== undefined &&
        (!Array.isArray(body.signatures) ||
          body.signatures.length > 3 ||
          body.signatures.some((s) => typeof s !== "string" || !/^0x[0-9a-f]{130}$/i.test(s)))
      )
        return send(res, 400, { error: "Expected up to 3 guardian signatures" });
      return send(
        res,
        200,
        await sponsoredWrite(() =>
          startRecovery(
            getAddress(newKey),
            wallet,
            body.request as string | undefined,
            body.signatures as `0x${string}`[] | undefined,
          ),
        ),
      );
    }

    if (route === "POST /api/recover/execute") {
      const body = await readJson(req);
      if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }))
        return send(res, 400, { error: "wallet is required" });
      return send(
        res,
        200,
        await sponsoredWrite(() => executeRecovery(getAddress(body.wallet as string))),
      );
    }

    if (route === "POST /api/recover/cancel") {
      const body = await readJson(req);
      if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }))
        return send(res, 400, { error: "wallet is required" });
      return send(
        res,
        200,
        await sponsoredWrite(() => cancelRecovery(getAddress(body.wallet as string))),
      );
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    // Surface a readable message without leaking RPC credentials or stack traces.
    const message =
      err &&
      typeof err === "object" &&
      "shortMessage" in err &&
      typeof err.shortMessage === "string"
        ? err.shortMessage
        : err instanceof Error
          ? err.message
          : "server error";
    return send(res, 500, { error: message.slice(0, 300) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`voxy api listening on http://${HOST}:${PORT}${API_TOKEN ? " (auth required)" : ""}`);
});
