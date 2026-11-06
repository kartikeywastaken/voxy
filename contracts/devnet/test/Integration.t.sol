// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RosterRegistry, RosterAttestation} from "../src/RosterRegistry.sol";
import {VoxyWallet, RecoveryDigest} from "../src/VoxyWallet.sol";
import {RosterPublisher, IEnsRegistryLike, ITextResolver} from "sepolia/RosterPublisher.sol";

/// Test-only stand-in for the real ENSv2 PermissionedRegistry on Sepolia. NOT a mock of Voxy code —
/// it represents the third-party ENS contract so the cross-chain hash contract can be proven locally.
/// The real integration runs against the live ENSv2 registry on Sepolia.
contract FakeEnsRegistry is IEnsRegistryLike {
    mapping(uint256 => State) public states;

    function setSlot(string memory label, uint8 status, uint64 expiry, address owner) external {
        uint256 anyId = uint256(keccak256(bytes(label)));
        states[anyId] = State({status: status, expiry: expiry, latestOwner: owner, tokenId: anyId, resource: anyId});
    }

    function getState(uint256 anyId) external view returns (State memory) {
        return states[anyId];
    }
}

contract FakeResolver is ITextResolver {
    string private _threshold;

    function setThreshold(string memory t) external {
        _threshold = t;
    }

    function text(bytes32, string calldata) external view returns (string memory) {
        return _threshold;
    }
}

/// Proves: Sepolia RosterPublisher output (guardians + hash) is accepted verbatim by the devnet
/// RosterRegistry, and a recovery against it succeeds. This is the cross-chain contract.
contract IntegrationTest is Test {
    RosterRegistry registry;
    VoxyWallet wallet;
    RosterPublisher publisher;
    FakeEnsRegistry ens;
    FakeResolver resolver;

    uint256 a1 = 0xA11CE;
    uint256 a2 = 0xA22CE;
    uint256 g1 = 0x6471D1;
    uint256 g2 = 0x6471D2;
    uint256 g3 = 0x6471D3;
    address owner = address(0x0E7E7);
    address newKey = address(0xBEEF);

    uint64 constant ADD_DELAY = 120;
    uint64 constant RECOVERY_DELAY = 180;

    function setUp() public {
        address[3] memory attesters = [vm.addr(a1), vm.addr(a2), address(0xA33CE)];
        registry = new RosterRegistry(attesters, ADD_DELAY);
        wallet = new VoxyWallet(owner, registry, RECOVERY_DELAY);
        publisher = new RosterPublisher();
        ens = new FakeEnsRegistry();
        resolver = new FakeResolver();

        // ENS state: g1,g2,g3 registered (status 2), not expired. threshold = 2.
        uint64 future = uint64(block.timestamp + 365 days);
        ens.setSlot("g1", 2, future, vm.addr(g1));
        ens.setSlot("g2", 2, future, vm.addr(g2));
        ens.setSlot("g3", 2, future, vm.addr(g3));
        resolver.setThreshold("2");
        publisher.configure(address(wallet), ens, resolver, bytes32(0));
    }

    function test_publisherHash_acceptedByRegistry_andRecoveryWorks() public {
        // 1. Sepolia side: read the live roster the way an attester would.
        (address[3] memory guardians, uint8 threshold,) = publisher.readRoster(address(wallet));
        bytes32 rosterHash = registry.hashRoster(guardians, threshold);
        assertEq(guardians[0], vm.addr(g1));
        assertEq(threshold, 2);

        // 2. Attesters sign that exact roster and submit to the devnet registry.
        RosterAttestation memory a = RosterAttestation({
            wallet: address(wallet),
            epoch: 1,
            rosterHash: rosterHash,
            guardian0: guardians[0],
            guardian1: guardians[1],
            guardian2: guardians[2],
            threshold: threshold,
            sepoliaBlockNumber: block.number,
            sepoliaBlockHash: blockhash(block.number > 0 ? block.number - 1 : 0),
            validUntil: uint64(block.timestamp + 1 hours)
        });
        bytes32 attDigest = _attestDigest(a);
        bytes[] memory attSigs = new bytes[](2);
        attSigs[0] = _sig(a1, attDigest);
        attSigs[1] = _sig(a2, attDigest);
        registry.submitRoster(a, attSigs);
        vm.warp(block.timestamp + ADD_DELAY + 1); // guardians become active

        // 3. Recovery on the devnet wallet using a guardian quorum.
        RosterRegistry.Roster memory r = registry.rosterOf(address(wallet));
        RecoveryDigest memory d = RecoveryDigest({
            chainId: block.chainid,
            wallet: address(wallet),
            newKey: newKey,
            ownerEpoch: wallet.ownerEpoch(),
            rosterEpoch: r.epoch,
            rosterHash: r.hash,
            deadline: uint64(block.timestamp + 1 hours),
            requestId: keccak256("integration-req"),
            callHash: keccak256("call")
        });
        bytes[] memory gsigs = new bytes[](2);
        gsigs[0] = _sig(g1, _walletDigest(d));
        gsigs[1] = _sig(g2, _walletDigest(d));
        wallet.requestRecovery(d, gsigs);
        vm.warp(block.timestamp + RECOVERY_DELAY + 1);
        wallet.executeRecovery();

        assertTrue(wallet.isOwner(newKey), "recovery added new owner via ENS-derived roster");
        assertTrue(wallet.isOwner(owner), "original owner intact (add-only)");
    }

    function test_expiredSlotTreatedAsEmpty() public {
        // expire g2 -> publisher reports it as address(0)
        ens.setSlot("g2", 2, uint64(block.timestamp - 1), vm.addr(g2));
        (address[3] memory guardians,,) = publisher.readRoster(address(wallet));
        assertEq(guardians[1], address(0), "expired slot is empty (bible 5.3 trap handled)");
    }

    // --- helpers ---

    function _walletDigest(RecoveryDigest memory d) internal view returns (bytes32) {
        bytes32 typehash = keccak256(
            "RecoveryDigest(uint256 chainId,address wallet,address newKey,uint64 ownerEpoch,uint64 rosterEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId,bytes32 callHash)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash, d.chainId, d.wallet, d.newKey, d.ownerEpoch, d.rosterEpoch, d.rosterHash, d.deadline, d.requestId, d.callHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", wallet.DOMAIN_SEPARATOR(), structHash));
    }

    function _attestDigest(RosterAttestation memory a) internal view returns (bytes32) {
        bytes32 typehash = keccak256(
            "RosterAttestation(address wallet,uint64 epoch,bytes32 rosterHash,address guardian0,address guardian1,address guardian2,uint8 threshold,uint256 sepoliaBlockNumber,bytes32 sepoliaBlockHash,uint64 validUntil)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash, a.wallet, a.epoch, a.rosterHash, a.guardian0, a.guardian1, a.guardian2, a.threshold, a.sepoliaBlockNumber, a.sepoliaBlockHash, a.validUntil
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
