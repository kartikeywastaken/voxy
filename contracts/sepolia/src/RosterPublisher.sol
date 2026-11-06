// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal mirror of ENSv2 PermissionedRegistry.getState (see reference/ens-v2 IPermissionedRegistry).
/// Status: 0 AVAILABLE, 1 RESERVED, 2 REGISTERED.
interface IEnsRegistryLike {
    struct State {
        uint8 status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
        uint256 resource;
    }

    function getState(uint256 anyId) external view returns (State memory state);
}

interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// Sepolia-side publisher. Reads a wallet's guardian roster LIVE from ENSv2 (expiry-aware) and its
/// threshold from an ENS text record, then emits RosterChanged (consumed by the attesters). Nothing
/// is hardcoded: guardians and threshold come from ENS state and are re-read on every publish.
///
/// The roster hash MUST equal RosterRegistry.hashRoster on the devnet:
///   keccak256(abi.encode(g0, g1, g2, threshold))
contract RosterPublisher {
    struct Config {
        IEnsRegistryLike registry; // the per-user ENSv2 UserRegistry holding g1/g2/g3
        ITextResolver resolver; // resolver for the user's name
        bytes32 node; // namehash of the user's name (for text records)
        bool set;
    }

    mapping(address => Config) public configOf;
    mapping(address => uint64) public epochOf;
    mapping(address => bytes32) public lastHashOf;

    event RosterChanged(
        address indexed account,
        uint64 epoch,
        bytes32 rosterHash,
        address[3] guardians,
        uint8 threshold,
        uint64 parentExpiry
    );

    /// Point a wallet at where its roster lives in ENS. Pointers only — the values stay in ENS.
    function configure(address account, IEnsRegistryLike registry, ITextResolver resolver, bytes32 node) external {
        configOf[account] = Config({registry: registry, resolver: resolver, node: node, set: true});
    }

    /// Read the live roster for an account. Expired or non-registered slots count as empty.
    function readRoster(address account)
        public
        view
        returns (address[3] memory guardians, uint8 threshold, uint64 parentExpiry)
    {
        Config memory c = configOf[account];
        require(c.set, "not configured");

        string[3] memory labels;
        labels[0] = "g1";
        labels[1] = "g2";
        labels[2] = "g3";

        for (uint256 i = 0; i < 3; i++) {
            uint256 anyId = uint256(keccak256(bytes(labels[i])));
            IEnsRegistryLike.State memory st = c.registry.getState(anyId);
            // REGISTERED (2) and not expired -> active guardian; else empty.
            if (st.status == 2 && st.expiry > block.timestamp) {
                guardians[i] = st.latestOwner;
            } else {
                guardians[i] = address(0);
            }
            if (st.expiry > parentExpiry) parentExpiry = st.expiry; // informational
        }

        threshold = _parseThreshold(c.resolver.text(c.node, "voxy.threshold"));
    }

    /// Emit a new roster epoch, only when the roster hash changed.
    function publish(address account) external {
        (address[3] memory g, uint8 threshold, uint64 parentExpiry) = readRoster(account);
        bytes32 h = keccak256(abi.encode(g[0], g[1], g[2], threshold));
        require(h != lastHashOf[account], "roster unchanged");
        uint64 epoch = epochOf[account] + 1;
        epochOf[account] = epoch;
        lastHashOf[account] = h;
        emit RosterChanged(account, epoch, h, g, threshold, parentExpiry);
    }

    function _parseThreshold(string memory s) internal pure returns (uint8) {
        bytes memory b = bytes(s);
        require(b.length == 1 && b[0] >= 0x31 && b[0] <= 0x33, "bad threshold record"); // '1'..'3'
        return uint8(b[0]) - 0x30;
    }
}
