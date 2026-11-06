// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RosterRegistry, RosterAttestation} from "../src/RosterRegistry.sol";
import {VoxyWallet, RecoveryDigest} from "../src/VoxyWallet.sol";

contract VoxyWalletTest is Test {
    RosterRegistry registry;
    VoxyWallet wallet;

    uint256 constant ADD_DELAY = 120;
    uint256 constant RECOVERY_DELAY = 180;

    // attesters
    uint256 a1 = 0xA11CE;
    uint256 a2 = 0xA22CE;
    uint256 a3 = 0xA33CE;
    // guardians
    uint256 g1 = 0x6471D1;
    uint256 g2 = 0x6471D2;
    uint256 g3 = 0x6471D3;
    // owner + recovery key
    uint256 ownerPk = 0x0E7E7;
    address newKey = address(0xBEEF);

    function setUp() public {
        address[3] memory attesters = [vm.addr(a1), vm.addr(a2), vm.addr(a3)];
        registry = new RosterRegistry(attesters, uint64(ADD_DELAY));
        wallet = new VoxyWallet(vm.addr(ownerPk), registry, uint64(RECOVERY_DELAY));
        _publishRoster(1, [vm.addr(g1), vm.addr(g2), vm.addr(g3)], 2);
        // move past ADD_DELAY so initial guardians are active
        vm.warp(block.timestamp + ADD_DELAY + 1);
    }

    function test_happyPath_addOnlyRecovery() public {
        bytes32 reqId = keccak256("req-1");
        RecoveryDigest memory d = _digest(newKey, reqId);
        bytes[] memory sigs = _guardianSigs(d, g1, g2);

        uint256 ownersBefore = wallet.ownerCount();
        wallet.requestRecovery(d, sigs);

        // too early
        vm.expectRevert("recovery not ready");
        wallet.executeRecovery();

        vm.warp(block.timestamp + RECOVERY_DELAY + 1);
        wallet.executeRecovery();

        assertTrue(wallet.isOwner(newKey), "new key is owner");
        assertEq(wallet.ownerCount(), ownersBefore + 1, "ADD-ONLY: owner added, none removed");
        assertTrue(wallet.isOwner(vm.addr(ownerPk)), "original owner intact");
    }

    function test_belowThreshold_reverts() public {
        bytes32 reqId = keccak256("req-2");
        RecoveryDigest memory d = _digest(newKey, reqId);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sig(g1, _walletDigest(d));
        vm.expectRevert("below threshold");
        wallet.requestRecovery(d, sigs);
    }

    function test_replaySameRequestId_reverts() public {
        bytes32 reqId = keccak256("req-3");
        RecoveryDigest memory d = _digest(newKey, reqId);
        bytes[] memory sigs = _guardianSigs(d, g1, g2);
        wallet.requestRecovery(d, sigs);
        vm.expectRevert("request used");
        wallet.requestRecovery(d, sigs);
    }

    function test_nonGuardianSignatures_dontCount() public {
        bytes32 reqId = keccak256("req-4");
        RecoveryDigest memory d = _digest(newKey, reqId);
        // two signatures, but from non-guardians
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(0xDEAD1, _walletDigest(d));
        sigs[1] = _sig(0xDEAD2, _walletDigest(d));
        vm.expectRevert("below threshold");
        wallet.requestRecovery(d, sigs);
    }

    function test_revokedGuardian_oldApprovalRejected() public {
        // revoke g2: new roster [g1, g3, 0], threshold 2, epoch 2
        _publishRoster(2, [vm.addr(g1), vm.addr(g3), address(0)], 2);

        bytes32 reqId = keccak256("req-5");
        // digest must carry the NEW roster epoch/hash
        RecoveryDigest memory d = _digest(newKey, reqId);
        // g2 is no longer active -> only g1 counts -> below threshold
        bytes[] memory sigs = _guardianSigs(d, g1, g2);
        vm.expectRevert("below threshold");
        wallet.requestRecovery(d, sigs);
    }

    function test_frozenBlocksRecovery() public {
        vm.prank(vm.addr(ownerPk));
        wallet.freeze();
        bytes32 reqId = keccak256("req-6");
        RecoveryDigest memory d = _digest(newKey, reqId);
        bytes[] memory sigs = _guardianSigs(d, g1, g2);
        vm.expectRevert("frozen");
        wallet.requestRecovery(d, sigs);
    }

    function test_newGuardianInactiveUntilAddDelay() public {
        // add g-new in slot3, epoch 2
        uint256 gNew = 0x6471D9;
        _publishRoster(2, [vm.addr(g1), vm.addr(g2), vm.addr(gNew)], 2);
        assertFalse(registry.isActiveGuardian(address(wallet), vm.addr(gNew)), "new guardian delayed");
        assertTrue(registry.isActiveGuardian(address(wallet), vm.addr(g1)), "carryover active");
        vm.warp(block.timestamp + ADD_DELAY + 1);
        assertTrue(registry.isActiveGuardian(address(wallet), vm.addr(gNew)), "active after delay");
    }

    // --- helpers ---

    function _publishRoster(uint64 epoch, address[3] memory g, uint8 threshold) internal {
        bytes32 rosterHash = registry.hashRoster(g, threshold);
        RosterAttestation memory a = RosterAttestation({
            wallet: address(wallet),
            epoch: epoch,
            rosterHash: rosterHash,
            guardian0: g[0],
            guardian1: g[1],
            guardian2: g[2],
            threshold: threshold,
            sepoliaBlockNumber: block.number,
            sepoliaBlockHash: blockhash(block.number - 1),
            validUntil: uint64(block.timestamp + 1 hours)
        });
        bytes32 digest = _attestDigest(a);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(a1, digest);
        sigs[1] = _sig(a2, digest);
        registry.submitRoster(a, sigs);
    }

    function _digest(address key, bytes32 reqId) internal view returns (RecoveryDigest memory) {
        RosterRegistry.Roster memory r = registry.rosterOf(address(wallet));
        return RecoveryDigest({
            chainId: block.chainid,
            wallet: address(wallet),
            newKey: key,
            ownerEpoch: wallet.ownerEpoch(),
            rosterEpoch: r.epoch,
            rosterHash: r.hash,
            deadline: uint64(block.timestamp + 1 hours),
            requestId: reqId,
            callHash: keccak256("call")
        });
    }

    function _guardianSigs(RecoveryDigest memory d, uint256 p1, uint256 p2) internal view returns (bytes[] memory) {
        bytes32 wd = _walletDigest(d);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(p1, wd);
        sigs[1] = _sig(p2, wd);
        return sigs;
    }

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
