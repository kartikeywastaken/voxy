// Thin client for the Voxy backend API (@voxy/api). Base URL is configurable for deploys.
const BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8787";

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
