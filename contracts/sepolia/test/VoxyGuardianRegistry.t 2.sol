// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Call, RecoveryDigest, VoxyDelegate} from "../src/VoxyDelegate.sol";
import {VoxyGuardianRegistry} from "../src/VoxyGuardianRegistry.sol";

contract VoxyGuardianRegistryTest is Test {
    VoxyGuardianRegistry reg;

    uint256 g1pk = 0xA11CE;
    uint256 g2pk = 0xB0B;
    uint256 g3pk = 0xC0FFEE;
    address g1;
    address g2;
    address g3;
    address account = address(0xACC0);

    function setUp() public {
        g1 = vm.addr(g1pk);
        g2 = vm.addr(g2pk);
        g3 = vm.addr(g3pk);
        reg = new VoxyGuardianRegistry();
        vm.prank(account);
        reg.setGuardians([g1, g2, g3], 2, 0);
    }

    function test_setAndReadRoster() public view {
        (address[3] memory gs, uint8 th,) = reg.readRoster(account);
        assertEq(gs[0], g1);
        assertEq(gs[1], g2);
        assertEq(gs[2], g3);
        assertEq(th, 2);
    }

    function test_revoke_failsClosed() public {
        vm.prank(account);
        reg.revoke(g2);
        (address[3] memory gs,,) = reg.readRoster(account);
        assertEq(gs[0], g1);
        assertEq(gs[1], address(0), "revoked guardian reads back as empty");
        assertEq(gs[2], g3);
    }

    function test_expiry_failsClosed() public {
        vm.prank(account);
        reg.setGuardians([g1, g2, g3], 2, uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 101);
        (address[3] memory gs,,) = reg.readRoster(account);
        assertEq(gs[0], address(0));
        assertEq(gs[1], address(0));
        assertEq(gs[2], address(0));
    }

    function test_badThreshold_reverts() public {
        vm.prank(account);
        vm.expectRevert(bytes("bad threshold"));
        reg.setGuardians([g1, g2, g3], 0, 0);
    }

    function test_thresholdExceedsGuardians_reverts() public {
        vm.prank(account);
        vm.expectRevert(bytes("threshold exceeds guardians"));
        reg.setGuardians([g1, address(0), address(0)], 3, 0);
    }

    // --- integration: recover a VoxyDelegate using NON-ENS guardians from our own registry ---

    function _digest(VoxyDelegate d, RecoveryDigest memory r) internal view returns (bytes32) {
        bytes32 ds = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Voxy"),
                keccak256("1"),
                block.chainid,
                address(d)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "RecoveryDigest(uint256 chainId,address account,address newController,uint64 ownerEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId)"
                ),
                r.chainId,
                r.account,
                r.newController,
                r.ownerEpoch,
                r.rosterHash,
                r.deadline,
                r.requestId
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", ds, structHash));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_delegateRecoversViaOurRegistry_noEns() public {
        VoxyDelegate d = new VoxyDelegate();
        // point the delegate at OUR registry as its guardian source — no ENS involved
        d.configure(address(reg), account, 180);

        address newKey = address(0x1234);
        RecoveryDigest memory rd = RecoveryDigest({
            chainId: block.chainid,
            account: address(d),
            newController: newKey,
            ownerEpoch: 0,
            rosterHash: d.hashRoster([g1, g2, g3], 2),
            deadline: uint64(block.timestamp + 1 hours),
            requestId: keccak256("reg-recover-1")
        });
        bytes32 digest = _digest(d, rd);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(g2pk, digest);

        d.requestRecovery(rd, sigs);
        vm.warp(block.timestamp + 181);
        d.executeRecovery();

        assertTrue(d.isController(newKey), "recovered via non-ENS registry guardians");
    }
}
