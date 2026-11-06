// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal on-chain resolver that holds the recovery policy (threshold) as an ENS-style text record.
/// Implements the standard ENS `text(node, key)` read interface, so RosterPublisher reads the
/// threshold live from chain state rather than a hardcoded constant. Owner-writable.
contract VoxyThresholdResolver {
    address public owner;
    mapping(bytes32 => mapping(string => string)) private _text;

    event TextChanged(bytes32 indexed node, string key, string value);

    constructor() {
        owner = msg.sender;
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        require(msg.sender == owner, "not owner");
        _text[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _text[node][key];
    }
}
