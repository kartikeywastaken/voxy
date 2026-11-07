// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IVoxyRegistryFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}

interface IVoxyUserRegistry {
    struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }
    function getState(uint256 anyId) external view returns (State memory);
    function register(string calldata label, address owner, address registry, address resolver, uint256 roles, uint64 expiry) external returns (uint256);
    function unregister(uint256 tokenId) external;
}

/// Each caller controls its own ENSv2 namespace; there is no operator/admin override.
contract VoxyEnsRoster {
    IVoxyRegistryFactory public immutable factory;
    address public immutable implementation;
    mapping(address => address) public registryOf;
    mapping(address => uint8) public thresholdOf;
    mapping(address => uint64) public expiryOf;

    event GuardiansSet(address indexed account, address registry, address[3] guardians, uint8 threshold, uint64 expiresAt);

    constructor(address factory_, address implementation_) {
        require(factory_.code.length > 0 && implementation_.code.length > 0, "missing ENS deployment");
        factory = IVoxyRegistryFactory(factory_);
        implementation = implementation_;
    }

    function setGuardians(address[3] calldata guardians, uint8 threshold, uint64 expiresAt) external {
        require(expiresAt > block.timestamp, "expired roster");
        uint256 count;
        for (uint256 i; i < 3; ++i) {
            address g = guardians[i];
            if (g == address(0)) continue;
            require(g != msg.sender, "account cannot guard itself");
            for (uint256 j; j < i; ++j) require(guardians[j] != g, "duplicate guardian");
            ++count;
        }
        require(threshold > 0 && threshold <= count, "invalid threshold");
        address registry = registryOf[msg.sender];
        if (registry == address(0)) {
            uint256 roles = (1 << 0) | (1 << 12) | (1 << 16) | (1 << 20) | (1 << 24);
            registry = factory.deployProxy(implementation, uint256(uint160(msg.sender)), abi.encodeWithSignature("initialize(address,uint256)", address(this), roles | (roles << 128)));
            registryOf[msg.sender] = registry;
        }
        IVoxyUserRegistry user = IVoxyUserRegistry(registry);
        for (uint256 i; i < 3; ++i) {
            string memory label = i == 0 ? "g1" : i == 1 ? "g2" : "g3";
            IVoxyUserRegistry.State memory st = user.getState(uint256(keccak256(bytes(label))));
            bool live = st.status == 2 && st.expiry > block.timestamp;
            if (live && st.latestOwner == guardians[i] && st.expiry == expiresAt) continue;
            if (live) user.unregister(st.tokenId);
            if (guardians[i] != address(0)) user.register(label, guardians[i], address(0), address(this), 0, expiresAt);
        }
        thresholdOf[msg.sender] = threshold;
        expiryOf[msg.sender] = expiresAt;
        emit GuardiansSet(msg.sender, registry, guardians, threshold, expiresAt);
    }

    function readRoster(address account) external view returns (address[3] memory guardians, uint8 threshold, uint64 parentExpiry) {
        address registry = registryOf[account];
        if (registry == address(0)) return (guardians, 0, 0);
        for (uint256 i; i < 3; ++i) {
            string memory label = i == 0 ? "g1" : i == 1 ? "g2" : "g3";
            IVoxyUserRegistry.State memory st = IVoxyUserRegistry(registry).getState(uint256(keccak256(bytes(label))));
            if (st.status == 2 && st.expiry > block.timestamp) guardians[i] = st.latestOwner;
        }
        return (guardians, thresholdOf[account], expiryOf[account]);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        if (keccak256(bytes(key)) != keccak256("voxy.threshold")) return "";
        // Node is the left-padded account address, so the resolver is independently readable.
        uint8 threshold = thresholdOf[address(uint160(uint256(node)))];
        return threshold == 0 ? "" : string(abi.encodePacked(bytes1(uint8(48 + threshold))));
    }
}
