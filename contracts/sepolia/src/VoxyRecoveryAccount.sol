// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VoxyEnsRoster} from "./VoxyEnsRoster.sol";

/// EIP-7702 implementation. State is namespaced so existing EOA storage is not reused.
contract VoxyRecoveryAccount {
    struct Call { address to; uint256 value; bytes data; }
    struct Enrollment { address account; address implementation; address guardian0; address guardian1; address guardian2; uint8 threshold; uint64 delay; uint64 expiresAt; uint64 deadline; }
    struct Recovery { uint256 chainId; address account; address newController; uint64 ownerEpoch; bytes32 rosterHash; uint64 deadline; bytes32 requestId; }
    struct Pending { address key; uint64 readyAt; bytes32 requestId; bytes32 rosterHash; uint64 ownerEpoch; }
    struct State {
        bool configured;
        bool frozen;
        uint64 ownerEpoch;
        uint64 recoveryDelay;
        uint256 executionNonce;
        Pending pending;
        mapping(address => bool) controllers;
        mapping(bytes32 => bool) usedRequests;
    }

    bytes32 private constant SLOT = keccak256("voxy.recovery.account.storage.v2");
    bytes32 private constant DOMAIN_TYPE = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ENROLL_TYPE = keccak256("Enrollment(address account,address implementation,address guardian0,address guardian1,address guardian2,uint8 threshold,uint64 delay,uint64 expiresAt,uint64 deadline)");
    bytes32 private constant RECOVERY_TYPE = keccak256("RecoveryDigest(uint256 chainId,address account,address newController,uint64 ownerEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId)");
    bytes32 private constant EXECUTION_TYPE = keccak256("Execution(address account,bytes32 callsHash,uint256 nonce,uint64 deadline)");
    VoxyEnsRoster public immutable rosterSource;
    address public immutable implementation;

    event Configured(address indexed account, address indexed registry, uint64 delay);
    event RecoveryRequested(address indexed account, address indexed newController, uint64 readyAt, bytes32 requestId);
    event RecoveryExecuted(address indexed account, address indexed controller);
    event RecoveryCancelled(address indexed account);
    event Executed(address indexed account, uint256 nonce);

    constructor(VoxyEnsRoster source) {
        require(address(source).code.length > 0, "missing roster source");
        rosterSource = source;
        implementation = address(this);
    }

    function _state() private pure returns (State storage s) { bytes32 slot = SLOT; assembly { s.slot := slot } }
    function configured() external view returns (bool) { return _state().configured; }
    function frozen() external view returns (bool) { return _state().frozen; }
    function ownerEpoch() external view returns (uint64) { return _state().ownerEpoch; }
    function recoveryDelay() external view returns (uint64) { return _state().recoveryDelay; }
    function executionNonce() external view returns (uint256) { return _state().executionNonce; }
    function pending() external view returns (Pending memory) { return _state().pending; }
    function isController(address who) public view returns (bool) { return who == address(this) || _state().controllers[who]; }

    function enroll(Enrollment calldata e, bytes calldata signature) external {
        State storage s = _state();
        require(!s.configured, "already configured");
        require(e.account == address(this) && e.implementation == implementation, "wrong enrollment");
        require(e.deadline >= block.timestamp && e.delay >= 180, "invalid enrollment timing");
        bytes32 hash = keccak256(abi.encode(ENROLL_TYPE, e.account, e.implementation, e.guardian0, e.guardian1, e.guardian2, e.threshold, e.delay, e.expiresAt, e.deadline));
        require(_recover(_digest(hash), signature) == address(this), "owner signature required");
        s.configured = true;
        s.recoveryDelay = e.delay;
        rosterSource.setGuardians([e.guardian0, e.guardian1, e.guardian2], e.threshold, e.expiresAt);
        emit Configured(address(this), rosterSource.registryOf(address(this)), e.delay);
    }

    function requestRecovery(Recovery calldata r, bytes[] calldata signatures) external {
        State storage s = _state();
        require(s.configured && !s.frozen, "recovery unavailable");
        require(r.chainId == block.chainid && r.account == address(this), "wrong account or chain");
        require(r.newController != address(0) && !isController(r.newController), "invalid new controller");
        require(r.ownerEpoch == s.ownerEpoch && r.deadline >= block.timestamp, "stale recovery");
        require(!s.usedRequests[r.requestId], "request used");
        (address[3] memory g, uint8 threshold,) = rosterSource.readRoster(address(this));
        require(threshold > 0 && r.rosterHash == hashRoster(g, threshold), "roster changed");
        // A revoked/expired roster must not strand the account behind an unfinishable request.
        require(s.pending.key == address(0) || s.pending.rosterHash != r.rosterHash || s.pending.ownerEpoch != s.ownerEpoch, "recovery already pending");
        bytes32 digest = _digest(keccak256(abi.encode(RECOVERY_TYPE, r.chainId, r.account, r.newController, r.ownerEpoch, r.rosterHash, r.deadline, r.requestId)));
        uint256 seen;
        uint256 count;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = _recover(digest, signatures[i]);
            for (uint256 j; j < 3; ++j) {
                if (g[j] != address(0) && signer == g[j] && (seen & (1 << j)) == 0) { seen |= 1 << j; ++count; }
            }
        }
        require(count >= threshold, "below threshold");
        s.usedRequests[r.requestId] = true;
        s.pending = Pending(r.newController, uint64(block.timestamp) + s.recoveryDelay, r.requestId, r.rosterHash, r.ownerEpoch);
        emit RecoveryRequested(address(this), r.newController, s.pending.readyAt, r.requestId);
    }

    function executeRecovery() external {
        State storage s = _state();
        Pending memory p = s.pending;
        require(!s.frozen && p.key != address(0) && block.timestamp >= p.readyAt, "recovery not ready");
        (address[3] memory g, uint8 threshold,) = rosterSource.readRoster(address(this));
        require(p.ownerEpoch == s.ownerEpoch && threshold > 0 && p.rosterHash == hashRoster(g, threshold), "recovery invalidated");
        delete s.pending;
        s.controllers[p.key] = true;
        ++s.ownerEpoch;
        emit RecoveryExecuted(address(this), p.key);
    }

    function execute(Call[] calldata calls) external {
        require(_state().configured && isController(msg.sender), "not controller");
        _execute(calls);
    }

    /// A sponsor can relay an exact controller-signed transfer; the sponsor never controls funds.
    function executeSigned(Call[] calldata calls, uint256 nonce, uint64 deadline, bytes calldata signature) external {
        State storage s = _state();
        require(s.configured && deadline >= block.timestamp && nonce == s.executionNonce, "stale execution");
        bytes32 digest = _digest(keccak256(abi.encode(EXECUTION_TYPE, address(this), keccak256(abi.encode(calls)), nonce, deadline)));
        address signer = _recover(digest, signature);
        require(signer != address(0) && isController(signer), "controller signature required");
        _execute(calls);
    }

    function _execute(Call[] calldata calls) private {
        State storage s = _state();
        uint256 nonce = s.executionNonce++;
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory result) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) { assembly { revert(add(result, 32), mload(result)) } }
        }
        emit Executed(address(this), nonce);
    }

    function cancelRecovery() external {
        require(_state().configured && isController(msg.sender), "not controller");
        delete _state().pending;
        ++_state().ownerEpoch;
        emit RecoveryCancelled(address(this));
    }
    function setFrozen(bool value) external {
        require(_state().configured && isController(msg.sender), "not controller");
        _state().frozen = value;
        if (value) { delete _state().pending; ++_state().ownerEpoch; }
    }
    function hashRoster(address[3] memory g, uint8 threshold) public pure returns (bytes32) { return keccak256(abi.encode(g[0], g[1], g[2], threshold)); }
    function _digest(bytes32 hash) private view returns (bytes32) { return keccak256(abi.encodePacked("\x19\x01", keccak256(abi.encode(DOMAIN_TYPE, keccak256("VoxyRecovery"), keccak256("2"), block.chainid, address(this))), hash)); }
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0 || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
    receive() external payable {}
}
