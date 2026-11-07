// Thin client for the Voxy backend API (@voxy/api). Base URL is configurable for deploys:
//  - VITE_API_URL set  -> use it (split deploy: e.g. a separate Render API host).
//  - unset in dev       -> local API on loopback.
//  - unset in prod build -> "" (same-origin), so the browser hits /api/* on this domain.
//    On Vercel the `/api/(.*)` rewrite routes those requests to the `api` service.
const BASE =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

async function call(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  state: (wallet) => call(wallet ? `/api/state?wallet=${encodeURIComponent(wallet)}` : "/api/state"),
  guardians: (wallet) => call(`/api/guardians${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`),
  guardianIntent: (guardians, threshold, wallet) => call("/api/guardians/prepare", { method: "POST", body: JSON.stringify({ guardians, threshold, wallet }) }),
  setGuardians: (guardians, threshold, wallet, authorization) =>
    call("/api/guardians/set", {
      method: "POST",
      body: JSON.stringify({ guardians, threshold, wallet, ...authorization }),
    }),
  prepareRecovery: (newKey, wallet) => call("/api/recover/prepare", { method: "POST", body: JSON.stringify({ newKey, wallet }) }),
  startRecovery: (newKey, wallet, request, signatures) =>
    call("/api/recover/start", { method: "POST", body: JSON.stringify({ newKey, wallet, request, signatures }) }),
  executeRecovery: (wallet) => call("/api/recover/execute", { method: "POST", body: JSON.stringify({ wallet }) }),
  cancelRecovery: (wallet) => call("/api/recover/cancel", { method: "POST", body: JSON.stringify({ wallet }) }),
  createWallet: (owner) =>
    call("/api/wallet/create", { method: "POST", body: JSON.stringify({ owner }) }),
  run7702: (destination) =>
    call("/api/7702/run", { method: "POST", body: JSON.stringify({ destination }) }),
  // --- recovery coordination hub ---
  requestRecovery: (wallet, newKey) =>
    call("/api/recover/request", { method: "POST", body: JSON.stringify({ wallet, newKey }) }),
  getRecoveryRequest: (id) => call(`/api/recover/request?id=${encodeURIComponent(id)}`),
  pendingForGuardian: (guardian) =>
    call(`/api/recover/pending?guardian=${encodeURIComponent(guardian)}`),
  approveRecovery: (id, signature) =>
    call("/api/recover/approve", { method: "POST", body: JSON.stringify({ id, signature }) }),
  demoApprove: (id) =>
    call("/api/recover/demo-approve", { method: "POST", body: JSON.stringify({ id }) }),
};

export const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—");
