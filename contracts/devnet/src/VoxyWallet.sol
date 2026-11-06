// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RosterRegistry} from "./RosterRegistry.sol";

/// EIP-712 digest a guardian signs to approve a recovery (see docs/INTERFACES.md).
struct RecoveryDigest {
    uint256 chainId;
    address wallet;
    address newKey;
    uint64 ownerEpoch;
    uint64 rosterEpoch;
    bytes32 rosterHash;
    uint64 deadline;
    bytes32 requestId;
    bytes32 callHash;
}

/// Social-recovery wallet whose guardian roster lives in RosterRegistry (synced from ENSv2 on Sepolia).
///
/// Recovery is ADD-ONLY: a quorum of guardians can install a *new additional* owner after a delay.
/// It can never remove owners, move funds, or change the roster. The owner can cancel or freeze.
///
/// On the EIP-8141 devnet this flow is driven by a VERIFY frame that reads each guardian's
/// protocol-resolved signer via `sigparam` (no ecrecover in validation). Here, and in Foundry tests
/// on anvil, the identical checks run against ECDSA signatures passed to `requestRecovery`. Same
/// rules, same digest — the only difference is how the signer is recovered.
contract VoxyWallet {
    mapping(address => bool) public isOwner;
    address[] private _owners;
    uint64 public ownerEpoch;

    RosterRegistry public immutable registry;
    uint64 public immutable recoveryDelay;
    bool public frozen;

    struct Pending {
        address key;
        uint64 readyAt;
        bytes32 requestId;
    }

    Pending public pending;
    mapping(bytes32 => bool) public usedRequestId;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant RECOVERY_TYPEHASH = keccak256(
        "RecoveryDigest(uint256 chainId,address wallet,address newKey,uint64 ownerEpoch,uint64 rosterEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId,bytes32 callHash)"
    );

    event RecoveryRequested(address indexed wallet, address newKey, uint64 readyAt, bytes32 requestId);
    event RecoveryExecuted(address indexed wallet, address newKey);
    event RecoveryCancelled(address indexed wallet);
    event FrozenSet(address indexed wallet, bool frozen);
    event OwnerAdded(address indexed wallet, address owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    constructor(address initialOwner, RosterRegistry registry_, uint64 recoveryDelay_) {
        registry = registry_;
        recoveryDelay = recoveryDelay_;
        _addOwner(initialOwner);
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

    /// Start a recovery with a guardian quorum. Installs a pending key; it becomes an owner only
    /// after `recoveryDelay` via executeRecovery.
    function requestRecovery(RecoveryDigest calldata d, bytes[] calldata guardianSigs) external {
        require(!frozen, "frozen");
        require(d.wallet == address(this), "wrong wallet");
        require(d.chainId == block.chainid, "wrong chain");
        require(d.ownerEpoch == ownerEpoch, "stale owner epoch");
        require(d.deadline >= block.timestamp, "deadline passed");
        require(!usedRequestId[d.requestId], "request used");

        RosterRegistry.Roster memory r = registry.rosterOf(address(this));
        require(r.threshold >= 1, "no roster");
        require(d.rosterEpoch == r.epoch, "stale roster epoch");
        require(d.rosterHash == r.hash, "roster hash mismatch");

        uint256 approvals = _countActiveGuardianApprovals(_digest(d), guardianSigs);
        require(approvals >= r.threshold, "below threshold");

        usedRequestId[d.requestId] = true;
        pending = Pending({key: d.newKey, readyAt: uint64(block.timestamp) + recoveryDelay, requestId: d.requestId});
        emit RecoveryRequested(address(this), d.newKey, pending.readyAt, d.requestId);
    }

    /// Finalise a pending recovery after the delay. ADD-ONLY: never removes an existing owner.
    function executeRecovery() external {
        require(pending.key != address(0), "no pending recovery");
        require(block.timestamp >= pending.readyAt, "recovery not ready");
        address key = pending.key;
        delete pending;
        _addOwner(key);
        ownerEpoch += 1;
        emit RecoveryExecuted(address(this), key);
    }

    function cancelRecovery() external onlyOwner {
        delete pending;
        emit RecoveryCancelled(address(this));
    }

    function freeze() external onlyOwner {
        frozen = true;
        emit FrozenSet(address(this), true);
    }

    function unfreeze() external onlyOwner {
        frozen = false;
        emit FrozenSet(address(this), false);
    }

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function ownerCount() external view returns (uint256) {
        return _owners.length;
    }

    // --- internal ---

    function _addOwner(address o) internal {
        require(o != address(0), "zero owner");
        if (!isOwner[o]) {
            isOwner[o] = true;
            _owners.push(o);
            emit OwnerAdded(address(this), o);
        }
    }

    function _countActiveGuardianApprovals(bytes32 digest, bytes[] calldata sigs)
        internal
        view
        returns (uint256 count)
    {
        address[] memory seen = new address[](sigs.length);
        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = _recover(digest, sigs[i]);
            if (!registry.isActiveGuardian(address(this), signer)) continue;
            bool dup;
            for (uint256 j = 0; j < i; j++) {
                if (seen[j] == signer) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;
            seen[i] = signer;
            count++;
        }
    }

    function _digest(RecoveryDigest calldata d) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                RECOVERY_TYPEHASH,
                d.chainId,
                d.wallet,
                d.newKey,
                d.ownerEpoch,
                d.rosterEpoch,
                d.rosterHash,
                d.deadline,
                d.requestId,
                d.callHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
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
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
