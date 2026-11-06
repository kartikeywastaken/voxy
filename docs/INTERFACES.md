# Interfaces (the contract between Claude and Codex)

Freeze this by H2. Everything crossing the A/B boundary lives here. Change only by mutual note.

## 1. EIP-712 structs

### RosterAttestation (attesters sign; RosterRegistry verifies on devnet)
```
RosterAttestation {
  address wallet;            // the KeyMesh wallet this roster is for
  uint64  epoch;             // monotonic; must equal stored epoch + 1
  bytes32 rosterHash;        // keccak(abi.encode(guardians, threshold, parentExpiryBucket))
  address[3] guardians;      // slot owners at read time; address(0) = empty/expired slot
  uint8   threshold;         // M in M-of-3
  uint256 sepoliaBlockNumber;
  bytes32 sepoliaBlockHash;
  uint64  validUntil;        // unix; submitRoster reverts if block.timestamp > validUntil
}
```

### RecoveryDigest (guardians sign; KeyMeshWallet VERIFY recomputes)
```
RecoveryDigest {
  uint256 chainId;
  address wallet;
  address newKey;            // the owner key being added (add-only)
  uint64  ownerEpoch;        // must match wallet.ownerEpoch
  uint64  rosterEpoch;       // must match RosterRegistry epoch
  bytes32 rosterHash;        // must match registry
  uint64  deadline;
  bytes32 requestId;         // single-use; also the EIP-8250 nonce key
  bytes32 callHash;          // keccak(nextFrame.target, nextFrame.data)
}
```

## 2. Devnet contract ABIs (Claude publishes real; Codex mocks until ~H8)

### RosterRegistry
```solidity
struct Roster { uint64 epoch; uint8 threshold; address[3] guardians; uint64[3] activeAt; bytes32 hash; }
function submitRoster(RosterAttestation calldata a, bytes[] calldata sigs) external;
function rosterOf(address wallet) external view returns (Roster memory);
function isActiveGuardian(address wallet, address g) external view returns (bool);
event RosterUpdated(address indexed wallet, uint64 epoch, bytes32 hash);
```

### KeyMeshWallet
```solidity
function requestRecovery(address newKey, bytes32 requestId) external;   // via SENDER frame after VERIFY quorum
function executeRecovery() external;                                    // after RECOVERY_DELAY
function cancelRecovery() external;                                     // owner only
function freeze() external;                                             // owner only
function owners() external view returns (address[] memory);
function pending() external view returns (address key, uint64 readyAt, bytes32 requestId);
event RecoveryRequested(address indexed wallet, address newKey, uint64 readyAt, bytes32 requestId);
event RecoveryExecuted(address indexed wallet, address newKey);
event RecoveryCancelled(address indexed wallet);
```

## 3. Sepolia contract (Claude)

### RosterPublisher
```solidity
function publish(address account) external;  // permissionless; emits only if rosterHash changed
event RosterChanged(address indexed account, uint64 epoch, bytes32 rosterHash,
                    address[3] guardians, uint8 threshold, uint64 parentExpiry);
```

## 4. Arkiv entity schema (Codex owns; both read)

All entities carry `project = "keymesh"`. Owner wallet = who may edit. Expiry native to Arkiv.

| Entity type | Owner | Expires | Queryable attrs | Payload (opaque) |
|---|---|---|---|---|
| `recovery-request` | initiator | at deadline | type, account, requestId, rosterEpoch, deadline, status | newKey, ownerEpoch, rosterHash, digest, callHash |
| `guardian-approval` | the guardian | at deadline | type, requestId, guardian, ens | signature (over RecoveryDigest) |
| `roster-snapshot` | publisher | long | type, account, epoch, hash | guardians, threshold, attestationSigs |

Clients MUST verify signature + roster membership + epoch before trusting any entity.

## 5. deployments.json (written by bootstrap; read by everyone)
```json
{
  "sepolia":  { "chainId": 11155111, "RosterPublisher": "0x..", "parentName": "keymesh.eth", "userRegistry": "0x.." },
  "devnet":   { "chainId": 1337, "RosterRegistry": "0x..", "KeyMeshWallet": "0x..", "RecoveryPaymaster": "0x.." },
  "ensv2":    { "VerifiableFactory": "0x118bc31a50d559f7015a8da26d54b3b030cdb70f", "...": "see GROUNDED_FACTS.md" },
  "arkiv":    { "chainId": 7794095, "writers": ["0x.."] }
}
```

## 6. Env var names
Canonical in `.env.example`. Never hardcode; read from env with documented defaults.
