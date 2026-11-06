// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Call, IRosterSource, RecoveryDigest, VoxyDelegate} from "../src/VoxyDelegate.sol";

contract MockRosterSource is IRosterSource {
    address[3] public guardians;
    uint8 public threshold;

    constructor(address[3] memory g, uint8 t) {
        guardians = g;
        threshold = t;
    }

    function readRoster(address) external view returns (address[3] memory, uint8, uint64) {
        return (guardians, threshold, uint64(block.timestamp + 365 days));
    }
}

contract Sink {
    uint256 public received;
    receive() external payable {
        received += msg.value;
    }
}

contract VoxyDelegateTest is Test {
    VoxyDelegate delegate;
    MockRosterSource source;

    uint256 g1pk = 0xA11CE;
    uint256 g2pk = 0xB0B;
    uint256 g3pk = 0xC0FFEE;
    uint256 strangerPk = 0xBAD;
    address g1;
    address g2;
    address g3;
    address newKey = address(0x1234);

    function setUp() public {
        g1 = vm.addr(g1pk);
        g2 = vm.addr(g2pk);
        g3 = vm.addr(g3pk);
        source = new MockRosterSource([g1, g2, g3], 2);
        delegate = new VoxyDelegate();
        delegate.configure(address(source), address(0xE), 180);
    }

    function _digest(address newController, uint64 ownerEpoch, bytes32 requestId) internal view returns (bytes32, RecoveryDigest memory) {
        RecoveryDigest memory d = RecoveryDigest({
            chainId: block.chainid,
            account: address(delegate),
            newController: newController,
            ownerEpoch: ownerEpoch,
            rosterHash: delegate.hashRoster([g1, g2, g3], 2),
            deadline: uint64(block.timestamp + 1 hours),
            requestId: requestId
        });
        bytes32 ds = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Voxy"),
                keccak256("1"),
                block.chainid,
                address(delegate)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "RecoveryDigest(uint256 chainId,address account,address newController,uint64 ownerEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId)"
                ),
                d.chainId,
                d.account,
                d.newController,
                d.ownerEpoch,
                d.rosterHash,
                d.deadline,
                d.requestId
            )
        );
        return (keccak256(abi.encodePacked("\x19\x01", ds, structHash)), d);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_happyPath_recovery_addsController_addOnly() public {
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r1"));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(g2pk, digest);

        delegate.requestRecovery(d, sigs);
        vm.warp(block.timestamp + 181);
        delegate.executeRecovery();

        assertTrue(delegate.isController(newKey), "new controller added");
        assertTrue(delegate.isController(address(delegate)), "self controller retained (add-only)");
        assertEq(delegate.ownerEpoch(), 1);
    }

    function test_belowThreshold_reverts() public {
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r2"));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sig(g1pk, digest);
        vm.expectRevert(bytes("below threshold"));
        delegate.requestRecovery(d, sigs);
    }

    function test_nonGuardianSignature_doesntCount() public {
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r3"));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(strangerPk, digest); // not a guardian
        vm.expectRevert(bytes("below threshold"));
        delegate.requestRecovery(d, sigs);
    }

    function test_duplicateGuardian_countsOnce() public {
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r4"));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(g1pk, digest); // same guardian twice
        vm.expectRevert(bytes("below threshold"));
        delegate.requestRecovery(d, sigs);
    }

    function test_replaySameRequestId_reverts() public {
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r5"));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(g2pk, digest);
        delegate.requestRecovery(d, sigs);
        vm.warp(block.timestamp + 181);
        delegate.executeRecovery();
        // epoch advanced -> same digest now stale; rebuild with used requestId but epoch 1
        (bytes32 d2, RecoveryDigest memory dd) = _digest(address(0xFEED), 1, keccak256("r5"));
        bytes[] memory sigs2 = new bytes[](2);
        sigs2[0] = _sig(g1pk, d2);
        sigs2[1] = _sig(g2pk, d2);
        vm.expectRevert(bytes("request used"));
        delegate.requestRecovery(dd, sigs2);
    }

    function test_recoveredController_canMoveFunds_viaExecute() public {
        // fund the account (the EOA whose funds never move addresses)
        vm.deal(address(delegate), 5 ether);
        // recover: add newKey as controller
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r6"));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(g2pk, digest);
        delegate.requestRecovery(d, sigs);
        vm.warp(block.timestamp + 181);
        delegate.executeRecovery();

        Sink sink = new Sink();
        Call[] memory calls = new Call[](1);
        calls[0] = Call({to: address(sink), value: 2 ether, data: ""});
        vm.prank(newKey);
        delegate.execute(calls);
        assertEq(sink.received(), 2 ether, "recovered key moved funds");
        assertEq(address(delegate).balance, 3 ether);
    }

    function test_execute_byRandom_reverts() public {
        vm.deal(address(delegate), 1 ether);
        Call[] memory calls = new Call[](1);
        calls[0] = Call({to: address(0xdead), value: 1, data: ""});
        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes("not controller"));
        delegate.execute(calls);
    }

    function test_frozenBlocksRecovery() public {
        // self (address(this) path) freezes; simulate via the account calling itself
        vm.prank(address(delegate));
        delegate.freeze();
        (bytes32 digest, RecoveryDigest memory d) = _digest(newKey, 0, keccak256("r7"));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sig(g1pk, digest);
        sigs[1] = _sig(g2pk, digest);
        vm.expectRevert(bytes("frozen"));
        delegate.requestRecovery(d, sigs);
    }

    /// Proves the EIP-7702 mechanic: an EOA delegates to VoxyDelegate and then operates as a
    /// smart account at its own address, funds in place.
    function test_eip7702_delegationMakesEoaControlItself() public {
        uint256 alicePk = 0xA11CE0007702;
        address alice = vm.addr(alicePk);
        vm.deal(alice, 3 ether);
        // Alice signs a 7702 authorization delegating her EOA to the VoxyDelegate implementation.
        vm.signAndAttachDelegation(address(delegate), alicePk);
        // Alice's address now has the delegate's code; she configures + executes as herself.
        VoxyDelegate acct = VoxyDelegate(payable(alice));
        vm.prank(alice);
        acct.configure(address(source), address(0xE), 180);

        Sink sink = new Sink();
        Call[] memory calls = new Call[](1);
        calls[0] = Call({to: address(sink), value: 1 ether, data: ""});
        vm.prank(alice);
        acct.execute(calls);
        assertEq(sink.received(), 1 ether, "EOA moved its own funds via the delegate");
        assertEq(alice.balance, 2 ether, "funds stayed at alice's address");
    }
}
