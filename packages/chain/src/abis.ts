/**
 * Hand-written ABIs for the exact entrypoints the backend touches. Kept minimal and authoritative:
 * they mirror the shipped Solidity in `contracts/` (see docs/INTERFACES.md). The compiled JSON ABIs
 * under `contracts/devnet/out/` remain the canonical full artifacts for the web/frame-SDK.
 */

export const rosterRegistryAbi = [
  {
    type: "function",
    name: "submitRoster",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "a",
        type: "tuple",
        components: [
          { name: "wallet", type: "address" },
          { name: "epoch", type: "uint64" },
          { name: "rosterHash", type: "bytes32" },
          { name: "guardian0", type: "address" },
          { name: "guardian1", type: "address" },
          { name: "guardian2", type: "address" },
          { name: "threshold", type: "uint8" },
          { name: "sepoliaBlockNumber", type: "uint256" },
          { name: "sepoliaBlockHash", type: "bytes32" },
          { name: "validUntil", type: "uint64" },
        ],
      },
      { name: "sigs", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rosterOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "epoch", type: "uint64" },
          { name: "threshold", type: "uint8" },
          { name: "guardians", type: "address[3]" },
          { name: "activeAt", type: "uint64[3]" },
          { name: "hash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isActiveGuardian",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "g", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hashRoster",
    stateMutability: "pure",
    inputs: [
      { name: "guardians", type: "address[3]" },
      { name: "threshold", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "attesters",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "RosterUpdated",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "epoch", type: "uint64", indexed: false },
      { name: "hash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const voxyWalletAbi = [
  {
    type: "function",
    name: "requestRecovery",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "d",
        type: "tuple",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "wallet", type: "address" },
          { name: "newKey", type: "address" },
          { name: "ownerEpoch", type: "uint64" },
          { name: "rosterEpoch", type: "uint64" },
          { name: "rosterHash", type: "bytes32" },
          { name: "deadline", type: "uint64" },
          { name: "requestId", type: "bytes32" },
          { name: "callHash", type: "bytes32" },
        ],
      },
      { name: "guardianSigs", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeRecovery",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelRecovery",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  { type: "function", name: "freeze", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unfreeze", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "owners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "ownerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isOwner",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "ownerEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "frozen",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "recoveryDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "pending",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "key", type: "address" },
      { name: "readyAt", type: "uint64" },
      { name: "requestId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "usedRequestId",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "RecoveryRequested",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "newKey", type: "address", indexed: false },
      { name: "readyAt", type: "uint64", indexed: false },
      { name: "requestId", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RecoveryExecuted",
    inputs: [
      { name: "wallet", type: "address", indexed: true },
      { name: "newKey", type: "address", indexed: false },
    ],
  },
] as const;

export const rosterPublisherAbi = [
  {
    type: "function",
    name: "readRoster",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "guardians", type: "address[3]" },
      { name: "threshold", type: "uint8" },
      { name: "parentExpiry", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "RosterChanged",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "epoch", type: "uint64", indexed: false },
      { name: "rosterHash", type: "bytes32", indexed: false },
      { name: "guardians", type: "address[3]", indexed: false },
      { name: "threshold", type: "uint8", indexed: false },
      { name: "parentExpiry", type: "uint64", indexed: false },
    ],
  },
] as const;
