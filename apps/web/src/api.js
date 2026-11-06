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
  state: () => call("/api/state"),
  startRecovery: (newKey) =>
    call("/api/recover/start", { method: "POST", body: JSON.stringify({ newKey }) }),
  executeRecovery: () => call("/api/recover/execute", { method: "POST" }),
};

export const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—");
