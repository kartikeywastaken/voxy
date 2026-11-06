# Deploying Voxy for others to test

Voxy has **two pieces** to host:

1. **Frontend** (`apps/web`) — a static Vite site. Hosts anywhere (Vercel, Netlify, Cloudflare Pages, GitHub Pages). It talks to the API via `VITE_API_URL` (baked in at build time).
2. **Backend API** (`apps/api`) — a small Node server that reads the live testnets and, for the demo, signs the guardian quorum with server-held **testnet** keys. It must run on a host that can hold env secrets (Render, Railway, Fly, a VPS).

> **Security note (read it).** This is a **testnet** demo. The API holds signing keys (guardians, deployer) in its environment and the recovery endpoints spend testnet gas. Keep only small funds on those keys, and set `VOXY_API_TOKEN` if you want to gate the fund-spending endpoints. Never put mainnet keys here.

---

## Option A — proper deploy (shareable URL)

### 1. API on Render (free)
A blueprint is committed at `render.yaml`.
- Push the repo to GitHub, then on Render: **New → Blueprint → pick the repo.** It builds `apps/api/Dockerfile`.
- Set the secret env vars (the `sync: false` ones) in the Render dashboard — copy them from your local `.env` (see `apps/api/.env.example`): the two RPC URLs, `ARKIV_ACCESS_KEY`, `ARKIV_WRITER_PK`, `DEVNET_DEPLOYER_PK`, `GUARDIAN_1..3_PK`, `ATTESTER_1..2_PK`, and optionally `VOXY_API_TOKEN`.
- After deploy, note the URL, e.g. `https://voxy-api.onrender.com`. Check `…/api/health` returns `{"ok":true}`.

(Railway/Fly work the same way from `apps/api/Dockerfile`; set `HOST=0.0.0.0`, they inject `PORT`.)

### 2. Frontend on Vercel or Netlify (free)
Configs are committed (`vercel.json`, `netlify.toml`).
- **Vercel:** import the repo, framework = Other, it uses `vercel.json`. Add env var `VITE_API_URL = https://voxy-api.onrender.com`. Deploy.
- **Netlify:** import the repo; `netlify.toml` sets build + publish. Edit `VITE_API_URL` there (or in the Netlify UI) to your API URL. Deploy.

Open the frontend URL → **Launch app** → the console reads live chain state and can run a real recovery. Share the URL.

---

## Option B — instant testing (no cloud account, ~2 min)

Run both locally and expose the API with a tunnel so others can hit your machine.

```sh
# 1. backend (reads your local .env)
pnpm --filter @voxy/api start            # http://127.0.0.1:8787

# 2. expose it publicly (pick one)
cloudflared tunnel --url http://127.0.0.1:8787     # prints https://xxxx.trycloudflare.com
# or: ngrok http 8787

# 3. frontend pointed at the tunnel, also tunneled (or hosted statically)
VITE_API_URL=https://xxxx.trycloudflare.com pnpm --filter @voxy/web dev   # http://127.0.0.1:5173
cloudflared tunnel --url http://127.0.0.1:5173     # share this URL
```

Anyone opening the frontend tunnel URL can test the live recovery against your machine. Stop the tunnels to take it offline.

---

## What testers can do
- See the **live system**: the wallet's owners, the ENS guardian roster, the cross-chain roster match (Sepolia ↔ devnet), and the three enforcement surfaces (ordinary tx / EIP-8141 frame / EIP-7702 EOA) with explorer links.
- **Run a real recovery**: enter a new owner address → the guardian quorum signs → a real on-chain `requestRecovery` → watch the time-lock → finalize (add-only). Every number is read from chain; every action is a real testnet transaction.

## Funding (keep the demo working)
- Devnet (1337) deployer gas: faucet button at the [alt-mempool explorer](https://explorer.altmempool.wtf/).
- Sepolia ETH: [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia).
- Rabdi tGLM (Arkiv writer): [Arkiv Hub faucet](https://hub.arkiv.network/faucet).

## Honest limits to tell testers
Experimental, testnet-only, not production. The frame path runs on an experimental alt-mempool devnet that can reset; EIP-7702 recovers key loss, not theft; the cross-chain sync trusts a small attester set. No audits.
