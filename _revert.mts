import { setGuardians } from "./apps/api/src/guardians.js";
const DEMO = "0xb7d81A26FC1293f638B3CDEF650cb84f80e9807E";
const g = [
  "0x6d3E1f382A6A059904F9a608eE53efA891a77aC8",
  "0xc24D0902DBF77CE2111c7128925E9276aB77424A",
  "0x7017ff35EC300e336D3fB5FFBC9A5a80A81a7C71",
];
(async () => {
  const r = await setGuardians({ guardians: g, threshold: 2, wallet: DEMO });
  console.log("roster guardians now:", JSON.stringify(r.guardians), "threshold", r.threshold);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
