import { addr, bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

const common = { project: str().indexed(), type: str().indexed(), payload: bytes() };

export const RecoveryRequests = defineSchema("voxy_recovery_request_v1", {
  ...common,
  account: addr().indexed(),
  requestId: str().indexed(),
  rosterEpoch: u64().indexed(),
  deadline: u64().indexed(),
  status: str().indexed(),
});

export const GuardianApprovals = defineSchema("voxy_guardian_approval_v1", {
  ...common,
  requestId: str().indexed(),
  guardian: addr().indexed(),
  ens: str().indexed(),
  deadline: u64().indexed(),
});

export const RosterSnapshots = defineSchema("voxy_roster_snapshot_v1", {
  ...common,
  account: addr().indexed(),
  epoch: u64().indexed(),
  hash: str().indexed(),
});

// Connection probes are explicitly separate from recovery coordination.
export const ConnectionChecks = defineSchema("voxy_connection_check_v1", {
  project: str().indexed(),
  probeId: str().indexed(),
  createdAt: u64(),
  payload: bytes(),
});

export const encodePayload = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
