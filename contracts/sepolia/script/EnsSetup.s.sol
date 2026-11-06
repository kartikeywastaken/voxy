// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VoxyThresholdResolver} from "../src/VoxyThresholdResolver.sol";

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}

interface IUserRegistry {
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256);
}

interface IRosterPublisher {
    function configure(address account, address registry, address resolver, bytes32 node) external;
    function publish(address account) external;
    function readRoster(address account)
        external
        view
        returns (address[3] memory guardians, uint8 threshold, uint64 parentExpiry);
}

/// Deploys a real ENSv2 UserRegistry (via the live VerifiableFactory on Sepolia), registers the
/// three guardian slots g1/g2/g3 as non-transferable, revocable, expiring subnames, sets the
/// threshold text record, wires the already-deployed RosterPublisher at it, and publishes a real
/// RosterChanged — all from live ENS state.
///
/// Run: forge script script/EnsSetup.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract EnsSetup is Script {
    // RegistryRolesLib bit positions (see docs/GROUNDED_FACTS.md).
    uint256 constant ROLE_REGISTRAR = 1 << 0;
    uint256 constant ROLE_UNREGISTER = 1 << 12;
    uint256 constant ROLE_RENEW = 1 << 16;
    uint256 constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 constant ROLE_SET_RESOLVER = 1 << 24;

    function run() external {
        uint256 pk = vm.envUint("SEPOLIA_DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address factory = vm.envAddress("ENS_VERIFIABLE_FACTORY");
        address userRegImpl = vm.envAddress("ENS_USER_REGISTRY_IMPL");
        address publisher = vm.envAddress("VOXY_SEPOLIA_ROSTER_PUBLISHER");
        address g1 = vm.envAddress("GUARDIAN_1_ADDRESS");
        address g2 = vm.envAddress("GUARDIAN_2_ADDRESS");
        address g3 = vm.envAddress("GUARDIAN_3_ADDRESS");
        // The account whose roster this is (the devnet VoxyWallet identity). Deployer stands in
        // until the devnet wallet is deployed; re-point with configure() later.
        address account = deployer;

        // Admin (deployer) gets register/unregister/renew/set-resolver/set-subregistry + their admins.
        uint256 baseRoles =
            ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_RENEW | ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER;
        uint256 adminRoles = baseRoles | (baseRoles << 128);

        bytes32 node = keccak256(bytes("voxy.eth")); // text-record node (consistent with configure)
        uint64 expiry = uint64(block.timestamp + 365 days);

        vm.startBroadcast(pk);

        // 1. Resolver holding the threshold policy.
        VoxyThresholdResolver resolver = new VoxyThresholdResolver();
        resolver.setText(node, "voxy.threshold", "2");

        // 2. Deploy a per-user ENSv2 UserRegistry proxy via the live VerifiableFactory.
        bytes memory initData = abi.encodeWithSignature("initialize(address,uint256)", deployer, adminRoles);
        uint256 salt = uint256(keccak256("voxy-user-registry-v1"));
        address userReg = IVerifiableFactory(factory).deployProxy(userRegImpl, salt, initData);

        // 3. Register the three guardian slots. roleBitmap = 0 => guardian holds the token but has
        //    no roles: cannot transfer it (non-transferable) and cannot change the resolver. The
        //    deployer (admin) keeps ROLE_UNREGISTER => revocable. expiry set => expiring.
        IUserRegistry(userReg).register("g1", g1, address(0), address(resolver), 0, expiry);
        IUserRegistry(userReg).register("g2", g2, address(0), address(resolver), 0, expiry);
        IUserRegistry(userReg).register("g3", g3, address(0), address(resolver), 0, expiry);

        // 4. Point the live RosterPublisher at this registry and publish a real roster.
        IRosterPublisher(publisher).configure(account, userReg, address(resolver), node);
        IRosterPublisher(publisher).publish(account);

        vm.stopBroadcast();

        console.log("UserRegistry proxy :", userReg);
        console.log("ThresholdResolver  :", address(resolver));
        console.log("Account (roster id):", account);
        (address[3] memory gs, uint8 th,) = IRosterPublisher(publisher).readRoster(account);
        console.log("Published guardian0:", gs[0]);
        console.log("Published threshold:", th);
    }
}
