import { and, asc, eq, gt } from "@arkiv-network/sdk/query";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { getAddress, isHex } from "viem";
import { arkivClients } from "./client.js";
import { GuardianApprovals, RecoveryRequests, RosterSnapshots } from "./schema.js";

export function bytes32(value: string): `0x${string}` {
  if (!isHex(value) || value.length !== 66) throw new Error("Expected a 32-byte hex value");
  return value.toLowerCase() as `0x${string}`;
}

const metadata = {
  $key: true,
  $owner: true,
  $creator: true,
  $expiresAt: true,
  $creationFlags: true,
  payload: true,
} as const;

export async function readRequests(account: string) {
  const { reader } = arkivClients();
  return reader
    .select({
      ...metadata,
      account: true,
      requestId: true,
      rosterEpoch: true,
      deadline: true,
      status: true,
    })
    .from(RecoveryRequests)
    .where(
      and(
        eq("project", "voxy"),
        eq("type", "recovery-request"),
        eq("account", addr(getAddress(account))),
        gt("deadline", u64(BigInt(Math.floor(Date.now() / 1000)))),
      ),
    )
    .orderBy(asc("$key"))
    .limit(100)
    .fetch();
}

export async function readApprovals(requestId: string) {
  const { reader } = arkivClients();
  return reader
    .select({ ...metadata, guardian: true, ens: true, requestId: true, deadline: true })
    .from(GuardianApprovals)
    .where(
      and(
        eq("project", "voxy"),
        eq("type", "guardian-approval"),
        eq("requestId", bytes32(requestId)),
        gt("deadline", u64(BigInt(Math.floor(Date.now() / 1000)))),
      ),
    )
    .orderBy(asc("$key"))
    .limit(100)
    .fetch();
}

export async function readSnapshots(account: string) {
  const { reader } = arkivClients();
  return reader
    .select({ ...metadata, account: true, epoch: true, hash: true })
    .from(RosterSnapshots)
    .where(
      and(
        eq("project", "voxy"),
        eq("type", "roster-snapshot"),
        eq("account", addr(getAddress(account))),
      ),
    )
    .orderBy(asc("$key"))
    .limit(100)
    .fetch();
}
