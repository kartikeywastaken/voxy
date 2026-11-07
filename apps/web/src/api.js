import { stringify } from "@voxy/chain/eoa";
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");
async function call(path, value) {
  const response = await fetch(`${BASE}/api/eoa/${path}`, { cache: "no-store", ...(value === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: stringify(value) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be verified. Try checking its status again.");
  return data;
}
export const api = {
  config: () => call("config"),
  account: (account, controller) => call(`account?address=${encodeURIComponent(account)}${controller ? `&controller=${encodeURIComponent(controller)}` : ""}`),
  nativeStatus: (hash) => call(`native-status?hash=${encodeURIComponent(hash)}`),
  operation: (id) => call(`operation?id=${encodeURIComponent(id)}`),
  prepareEnrollment: (account, guardians) => call("enrollment/prepare", { account, guardians }),
  enroll: (input) => call("enrollment", input),
  prepareRecovery: (account, newController) => call("recovery/prepare", { account, newController }),
  requestRecovery: (message, proof) => call("recovery/request", { message, proof }),
  recovery: (id) => call(`recovery?id=${encodeURIComponent(id)}`),
  requests: (kind, value) => call(`requests?${kind}=${encodeURIComponent(value)}`),
  approve: (id, signature) => call("recovery/approve", { id, signature }),
  submit: (id) => call("recovery/submit", { id }),
  finalize: (account) => call("recovery/finalize", { account }),
  prepareController: (input) => call("controller/prepare", input),
  controller: (input) => call("controller", input),
  prepareTransfer: (input) => call("transfer/prepare", input),
  transfer: (input) => call("transfer", input),
};
export const short = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
