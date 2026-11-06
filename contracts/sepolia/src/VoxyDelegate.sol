// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Live roster source (the ENSv2-backed RosterPublisher on Sepolia).
interface IRosterSource {
    function readRoster(address account)
        external
        view
        returns (address[3] memory guardians, uint8 threshold, uint64 parentExpiry);
}

struct Call {
    address to;
    uint256 value;
    bytes data;
}

/// Guardians EIP-712-sign this to authorise adding a new controller to the account.
struct RecoveryDigest {
    uint256 chainId;
    address account; // the EOA/account being recovered (== address(this))
    address newController; // the key being ADDED (add-only)
    uint64 ownerEpoch;
    bytes32 rosterHash;
    uint64 deadline;
    bytes32 requestId;
}

/// Voxy recovery for an EXISTING EOA via EIP-7702.
///
/// While they still hold their key, the user sends one EIP-7702 SetCode authorization delegating
/// their EOA to this contract. Their address, funds and history are untouched — the account merely
/// gains this code and storage. The account is then controllable by:
///   - itself (the EOA key, when the account calls its own `execute`), and
///   - any key ADDED as a controller through guardian recovery.
///
/// Guardians are read LIVE from the ENSv2 roster (IRosterSource.readRoster), so the guardian set is
/// the user's ENS identity, not a list baked into one wallet. Recovery is ADD-ONLY: a quorum can
/// install an additional controller after a delay; it can never remove a controller or move funds.
///
/// Scope (honest): EIP-7702 keeps the raw EOA key authoritative, so this recovers from key LOSS
/// (the lost key can no longer sign; guardians add a working controller) — it does NOT neutralise a
/// key THEFT (a thief's key still signs directly and could even remove the delegation).
contract VoxyDelegate {
    mapping(address => bool) public isController;
    uint64 public ownerEpoch;
    bool public frozen;
    bool private _configured;

    IRosterSource public rosterSource;
    address public rosterAccount; // the ENS roster account whose guardians govern this wallet
    uint64 public recoveryDelay;

    struct Pending {
        address key;
        uint64 readyAt;
        bytes32 requestId;
    }

    Pending public pending;
    mapping(bytes32 => bool) public usedRequestId;

    bytes32 private constant RECOVERY_TYPEHASH = keccak256(
        "RecoveryDigest(uint256 chainId,address account,address newController,uint64 ownerEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId)"
    );

    event Configured(address indexed account, address rosterSource, address rosterAccount, uint64 recoveryDelay);
    event RecoveryRequested(address indexed account, address newController, uint64 readyAt, bytes32 requestId);
    event RecoveryExecuted(address indexed account, address newController);
    event RecoveryCancelled(address indexed account);
    event FrozenSet(address indexed account, bool frozen);
    event ControllerAdded(address indexed account, address controller);
    event Executed(address indexed account, address to, uint256 value);

    /// The account itself (the EOA key signing for its own address) or an added controller.
    modifier onlyController() {
        require(msg.sender == address(this) || isController[msg.sender], "not controller");
        _;
    }

    /// One-time setup, done by the owner right after delegating (while they still hold the key).
    /// Points the account at its ENS-backed guardian roster.
    function configure(address source, address account, uint64 delay) external {
        require(msg.sender == address(this) || !_configured, "configured");
        require(source != address(0), "zero source");
        _configured = true;
        rosterSource = IRosterSource(source);
        rosterAccount = account;
        recoveryDelay = delay;
        if (!isController[address(this)]) {
            isController[address(this)] = true;
            emit ControllerAdded(address(this), address(this));
        }
        emit Configured(address(this), source, account, delay);
    }

    /// Run arbitrary calls from the account. This is how a recovered controller operates the funds
    /// that never left the address.
    function execute(Call[] calldata calls) external onlyController {
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            require(ok, _revertMsg(ret));
            emit Executed(address(this), calls[i].to, calls[i].value);
        }
    }

    /// Canonical roster hash — identical to the devnet RosterRegistry so one ENS roster is portable.
    function hashRoster(address[3] memory guardians, uint8 threshold) public pure returns (bytes32) {
        return keccak256(abi.encode(guardians[0], guardians[1], guardians[2], threshold));
    }

    function requestRecovery(RecoveryDigest calldata d, bytes[] calldata guardianSigs) external {
        require(!frozen, "frozen");
        require(_configured, "not configured");
        require(d.account == address(this), "wrong account");
        require(d.chainId == block.chainid, "wrong chain");
        require(d.ownerEpoch == ownerEpoch, "stale owner epoch");
        require(d.deadline >= block.timestamp, "deadline passed");
        require(d.newController != address(0), "zero controller");
        require(!usedRequestId[d.requestId], "request used");

        (address[3] memory guardians, uint8 threshold,) = rosterSource.readRoster(rosterAccount);
        require(threshold >= 1, "no roster");
        require(d.rosterHash == hashRoster(guardians, threshold), "roster hash mismatch");

        uint256 approvals = _countGuardianApprovals(_digest(d), guardianSigs, guardians);
        require(approvals >= threshold, "below threshold");

        usedRequestId[d.requestId] = true;
        pending = Pending({key: d.newController, readyAt: uint64(block.timestamp) + recoveryDelay, requestId: d.requestId});
        emit RecoveryRequested(address(this), d.newController, pending.readyAt, d.requestId);
    }

    function executeRecovery() external {
        require(pending.key != address(0), "no pending recovery");
        require(block.timestamp >= pending.readyAt, "recovery not ready");
        address key = pending.key;
        delete pending;
        if (!isController[key]) {
            isController[key] = true;
            emit ControllerAdded(address(this), key);
        }
        ownerEpoch += 1;
        emit RecoveryExecuted(address(this), key);
    }

    function cancelRecovery() external onlyController {
        delete pending;
        emit RecoveryCancelled(address(this));
    }

    function freeze() external onlyController {
        frozen = true;
        emit FrozenSet(address(this), true);
    }

    function unfreeze() external onlyController {
        frozen = false;
        emit FrozenSet(address(this), false);
    }

    receive() external payable {}

    // --- internal ---

    function _countGuardianApprovals(bytes32 digest, bytes[] calldata sigs, address[3] memory guardians)
        internal
        pure
        returns (uint256 count)
    {
        uint256 seenSlots;
        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = _recover(digest, sigs[i]);
            for (uint256 g = 0; g < 3; g++) {
                if (guardians[g] == signer && guardians[g] != address(0) && (seenSlots & (1 << g)) == 0) {
                    seenSlots |= (1 << g);
                    count++;
                    break;
                }
            }
        }
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Voxy"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function _digest(RecoveryDigest calldata d) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                RECOVERY_TYPEHASH, d.chainId, d.account, d.newController, d.ownerEpoch, d.rosterHash, d.deadline, d.requestId
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
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

    function _revertMsg(bytes memory ret) internal pure returns (string memory) {
        if (ret.length < 68) return "call failed";
        assembly {
            ret := add(ret, 0x04)
        }
        return abi.decode(ret, (string));
    }
}
