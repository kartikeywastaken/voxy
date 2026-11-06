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
/// VERIFY -> SENDER binding: `requestRecoveryFrame` requires `msg.sender == address(this)`, so it is
/// only reachable from a SENDER frame that calls this wallet as itself — which can only run after the
/// VERIFY prefix approved a quorum (or owner). No transient storage is used, keeping VERIFY inside the
/// alt-mempool validation rules. The guardians' signatures commit to the whole tx (incl. the SENDER
/// frame's calldata), so `newKey`/`requestId` are bound without a separate digest.
contract VoxyWalletFrame is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    RosterRegistry public immutable registry;
    uint64 public immutable recoveryDelay;
    /// The initial owner, kept as an immutable (in code, not storage) so the owner fast path in
    /// VERIFY needs no SLOAD — an unstaked wallet (e.g. its own staking tx) may not read storage
    /// in validation under the alt-mempool rules.
    address public immutable firstOwner;

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
        firstOwner = initialOwner;
        _addOwner(initialOwner);
    }

    /// The VERIFY frame whose target is this wallet lands here. It must fit in MAX_VERIFY_GAS
    /// (100k on this devnet) and use no environment opcodes (no TIMESTAMP), so it reads the roster
    /// ONCE and checks guardian membership in memory, with no time-based `activeAt` comparison
    /// (an empty slot, activeAt == 0, is simply ignored). The add-delay timing is still enforced
    /// in RosterRegistry and the execution-path VoxyWallet; it is relaxed here to stay under the
    /// validation gas/opcode rules.
    fallback() external payable {
        // Owner fast path (cheapest, no SLOAD): the first signer is the immutable owner. This is the
        // path the wallet's own (unstaked) staking tx takes, so it must not read storage.
        if (_signer(0) == firstOwner) {
            approve(Scope.EXECUTION_AND_PAYMENT);
            return;
        }

        // Recovery path: a quorum of distinct guardians from the roster (one foreign read).
        require(!frozen, "frozen");
        RosterRegistry.Roster memory r = registry.rosterOf(address(this));
        require(r.threshold > 0, "no roster");

        uint256 sigCount = txparam(TxParam.SIGNATURE_COUNT);
        uint256 count;
        uint256 countedSlots; // bitmap over the 3 roster slots, for dedup
        for (uint256 i = 0; i < sigCount; i++) {
            address s = _signer(i);
            for (uint256 g = 0; g < 3; g++) {
                if (r.guardians[g] == s && r.activeAt[g] != 0 && (countedSlots & (1 << g)) == 0) {
                    countedSlots |= (1 << g);
                    count++;
                    break;
                }
            }
        }
        require(count >= r.threshold, "below threshold");
        approve(Scope.EXECUTION_AND_PAYMENT);
    }

    receive() external payable {}

    /// SENDER-frame action: arm a pending recovery. Only reachable from a SENDER frame that calls
    /// this wallet as itself (`msg.sender == address(this)`), which can only run after the VERIFY
    /// prefix above approved a guardian quorum (or an owner). A direct external call cannot forge
    /// `msg.sender`, so it cannot arm a recovery without passing VERIFY. No transient storage is
    /// used, so VERIFY stays within the alt-mempool validation rules.
    function requestRecoveryFrame(address newKey, bytes32 requestId) external {
        require(msg.sender == address(this), "only via verified frame");
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
}
