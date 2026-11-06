// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {Devnet} from "@forshtat/hegota-support/contracts/Devnet.sol";
import {Scope, SigParam, TxParam} from "@forshtat/hegota-support/contracts/Params.sol";
import {RosterRegistry} from "../src/RosterRegistry.sol";

/// EIP-8141 frame-native Voxy wallet. The VERIFY frame reads each guardian's PROTOCOL-RESOLVED
/// signer via `sigparam` (no ecrecover in validation), checks the quorum against RosterRegistry,
/// and approves. Because reading the roster is a cross-account storage read, the canonical mempool
/// rejects this tx and the standard alt-mempool admits it once the wallet is staked — which is the
/// whole point of the EF Frame-Transaction Alternative Mempool track.
///
/// VERIFY -> SENDER binding: the VERIFY frame sets a transient flag only on a valid guardian quorum;
/// `requestRecoveryFrame` (the SENDER frame's call) requires that flag, so it cannot be invoked by a
/// direct call that skipped VERIFY. The guardians' signatures commit to the whole tx (including the
/// SENDER frame's calldata), so `newKey`/`requestId` are bound without a separate digest.
///
/// STATUS: pending live devnet validation — the reset devnet is missing the staking predeploy, so
/// staked alt-mempool admission cannot be exercised yet. The recovery state machine itself is the
/// same logic proven in VoxyWallet (9 tests + live devnet run). Do not claim admission until tested.
contract VoxyWalletFrame is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    RosterRegistry public immutable registry;
    uint64 public immutable recoveryDelay;

    mapping(address => bool) public isOwner;
    address[] private _owners;
    uint64 public ownerEpoch;
    bool public frozen;

    struct Pending {
        address key;
        uint64 readyAt;
        bytes32 requestId;
    }

    Pending public pending;
    mapping(bytes32 => bool) public usedRequestId;

    // transient slot: set by a successful VERIFY, consumed by requestRecoveryFrame in the same tx.
    bytes32 private constant VERIFIED_SLOT = keccak256("voxy.frame.verified");

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
    }

    /// The VERIFY frame whose target is this wallet lands here.
    fallback() external payable {
        uint256 sigCount = txparam(TxParam.SIGNATURE_COUNT);

        // Owner path: any single owner signature authorises the tx.
        for (uint256 i = 0; i < sigCount; i++) {
            if (isOwner[_signer(i)]) {
                _setVerified();
                approve(Scope.EXECUTION_AND_PAYMENT);
                return;
            }
        }

        // Recovery path: a quorum of distinct ACTIVE guardians.
        require(!frozen, "frozen");
        uint8 threshold = registry.rosterOf(address(this)).threshold;
        require(threshold > 0, "no roster");

        uint256 count;
        address[] memory seen = new address[](sigCount);
        for (uint256 i = 0; i < sigCount; i++) {
            address s = _signer(i);
            if (!registry.isActiveGuardian(address(this), s)) continue;
            bool dup;
            for (uint256 j = 0; j < i; j++) {
                if (seen[j] == s) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;
            seen[i] = s;
            count++;
        }
        require(count >= threshold, "below threshold");
        _setVerified();
        approve(Scope.EXECUTION_AND_PAYMENT);
    }

    receive() external payable {}

    /// SENDER-frame action: arm a pending recovery. Guarded by the transient VERIFY flag.
    function requestRecoveryFrame(address newKey, bytes32 requestId) external {
        require(_consumeVerified(), "not verified by a quorum");
        require(newKey != address(0), "zero key");
        require(!usedRequestId[requestId], "request used");
        usedRequestId[requestId] = true;
        pending = Pending({key: newKey, readyAt: uint64(block.timestamp) + recoveryDelay, requestId: requestId});
        emit RecoveryRequested(address(this), newKey, pending.readyAt, requestId);
    }

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

    function _signer(uint256 i) internal view returns (address) {
        return address(uint160(sigparam(i, SigParam.RESOLVED_SIGNER)));
    }

    function _addOwner(address o) internal {
        require(o != address(0), "zero owner");
        if (!isOwner[o]) {
            isOwner[o] = true;
            _owners.push(o);
            emit OwnerAdded(address(this), o);
        }
    }

    function _setVerified() internal {
        bytes32 slot = VERIFIED_SLOT;
        assembly {
            tstore(slot, 1)
        }
    }

    function _consumeVerified() internal returns (bool ok) {
        bytes32 slot = VERIFIED_SLOT;
        assembly {
            ok := tload(slot)
            tstore(slot, 0)
        }
    }
}
