// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// EIP-712 attestation signed by each attester off-chain (see packages/attester).
/// Flattened guardians (no array) so the off-chain signer and this contract hash identically.
struct RosterAttestation {
    address wallet;
    uint64 epoch;
    bytes32 rosterHash;
    address guardian0;
    address guardian1;
    address guardian2;
    uint8 threshold;
    uint256 sepoliaBlockNumber;
    bytes32 sepoliaBlockHash;
    uint64 validUntil;
}

/// Devnet registry of per-wallet guardian rosters, synced from Sepolia by a 2-of-3 attester set.
///
/// Trust model (bible 6): the sync is ATTESTED, not trustless. The reducer is asymmetric timing —
/// a newly added guardian only becomes active after `addDelay` (weakening is delayed), while
/// carryover guardians stay active immediately (strengthening/removal is instant).
contract RosterRegistry {
    struct Roster {
        uint64 epoch;
        uint8 threshold;
        address[3] guardians;
        uint64[3] activeAt; // guardian i is active once block.timestamp >= activeAt[i] (0 => empty slot)
        bytes32 hash;
    }

    address[3] public attesters; // fixed 2-of-3 attester set
    uint64 public immutable addDelay; // seconds a newly added guardian stays inactive

    mapping(address => Roster) private _rosters;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant ATTEST_TYPEHASH = keccak256(
        "RosterAttestation(address wallet,uint64 epoch,bytes32 rosterHash,address guardian0,address guardian1,address guardian2,uint8 threshold,uint256 sepoliaBlockNumber,bytes32 sepoliaBlockHash,uint64 validUntil)"
    );

    event RosterUpdated(address indexed wallet, uint64 epoch, bytes32 hash);

    constructor(address[3] memory attesters_, uint64 addDelay_) {
        attesters = attesters_;
        addDelay = addDelay_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Voxy"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// Canonical roster hash. The Sepolia publisher and the off-chain attester reproduce this exactly.
    function hashRoster(address[3] memory guardians, uint8 threshold) public pure returns (bytes32) {
        return keccak256(abi.encode(guardians[0], guardians[1], guardians[2], threshold));
    }

    /// Submit a new roster. Requires 2-of-3 distinct attester signatures and epoch == stored + 1.
    function submitRoster(RosterAttestation calldata a, bytes[] calldata sigs) external {
        require(block.timestamp <= a.validUntil, "attestation expired");
        require(a.threshold >= 1 && a.threshold <= 3, "bad threshold");

        Roster storage prev = _rosters[a.wallet];
        require(a.epoch == prev.epoch + 1, "bad epoch");

        address[3] memory guardians = [a.guardian0, a.guardian1, a.guardian2];
        require(a.rosterHash == hashRoster(guardians, a.threshold), "roster hash mismatch");

        _require2of3(_digest(a), sigs);

        // Asymmetric timing: the initial guardian set (bootstrap) and carryover guardians are active
        // immediately; guardians ADDED to an existing roster are delayed by addDelay (weakening).
        bool bootstrap = (prev.epoch == 0);
        uint64[3] memory activeAt;
        for (uint256 i = 0; i < 3; i++) {
            address g = guardians[i];
            if (g == address(0)) {
                activeAt[i] = 0;
            } else if (bootstrap || _wasActiveGuardian(prev, g)) {
                activeAt[i] = uint64(block.timestamp);
            } else {
                activeAt[i] = uint64(block.timestamp) + addDelay;
            }
        }

        _rosters[a.wallet] =
            Roster({epoch: a.epoch, threshold: a.threshold, guardians: guardians, activeAt: activeAt, hash: a.rosterHash});
        emit RosterUpdated(a.wallet, a.epoch, a.rosterHash);
    }

    function rosterOf(address wallet) external view returns (Roster memory) {
        return _rosters[wallet];
    }

    function isActiveGuardian(address wallet, address g) public view returns (bool) {
        if (g == address(0)) return false;
        Roster storage r = _rosters[wallet];
        for (uint256 i = 0; i < 3; i++) {
            if (r.guardians[i] == g) {
                return r.activeAt[i] != 0 && block.timestamp >= r.activeAt[i];
            }
        }
        return false;
    }

    // --- internal ---

    function _wasActiveGuardian(Roster storage prev, address g) internal view returns (bool) {
        for (uint256 i = 0; i < 3; i++) {
            if (prev.guardians[i] == g && prev.activeAt[i] != 0 && block.timestamp >= prev.activeAt[i]) {
                return true;
            }
        }
        return false;
    }

    function _digest(RosterAttestation calldata a) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ATTEST_TYPEHASH,
                a.wallet,
                a.epoch,
                a.rosterHash,
                a.guardian0,
                a.guardian1,
                a.guardian2,
                a.threshold,
                a.sepoliaBlockNumber,
                a.sepoliaBlockHash,
                a.validUntil
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _require2of3(bytes32 digest, bytes[] calldata sigs) internal view {
        require(sigs.length >= 2, "need 2 sigs");
        uint256 mask;
        uint256 count;
        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = _recover(digest, sigs[i]);
            for (uint256 j = 0; j < 3; j++) {
                if (attesters[j] == signer && (mask & (1 << j)) == 0) {
                    mask |= (1 << j);
                    count++;
                    break;
                }
            }
        }
        require(count >= 2, "need 2-of-3 attesters");
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // reject high-s (malleability)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
