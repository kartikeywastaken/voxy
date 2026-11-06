// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RosterRegistry, RosterAttestation} from "../src/RosterRegistry.sol";
import {VoxyWallet, RecoveryDigest} from "../src/VoxyWallet.sol";

/// Exercises the full recovery on the LIVE devnet, playing both attesters and guardians.
///   start()  -> submitRoster (2 attester sigs) then requestRecovery (2 guardian sigs)
///   finish() -> executeRecovery (run after RECOVERY_DELAY seconds)
///
/// Run:
///   forge script script/DevnetRecoveryFlow.s.sol:DevnetRecoveryFlow --sig "start()"  --rpc-url $DEVNET_RPC_URL --broadcast --legacy --slow
///   (wait RECOVERY_DELAY_SECONDS)
///   forge script script/DevnetRecoveryFlow.s.sol:DevnetRecoveryFlow --sig "finish()" --rpc-url $DEVNET_RPC_URL --broadcast --legacy --slow
contract DevnetRecoveryFlow is Script {
    function _reg() internal view returns (RosterRegistry) {
        return RosterRegistry(vm.envAddress("DEVNET_ROSTER_REGISTRY"));
    }

    function _wal() internal view returns (VoxyWallet) {
        return VoxyWallet(vm.envAddress("DEVNET_VOXY_WALLET"));
    }

    function newKey() public pure returns (address) {
        return vm.addr(uint256(keccak256("voxy-recovered-key-v1")));
    }

    function requestId() public pure returns (bytes32) {
        return keccak256("voxy-devnet-recovery-1");
    }

    function start() external {
        RosterRegistry reg = _reg();
        VoxyWallet wal = _wal();
        uint256 deployerPk = vm.envUint("DEVNET_DEPLOYER_PK");

        address g1 = vm.envAddress("GUARDIAN_1_ADDRESS");
        address g2 = vm.envAddress("GUARDIAN_2_ADDRESS");
        address g3 = vm.envAddress("GUARDIAN_3_ADDRESS");
        uint8 threshold = 2;
        bytes32 rosterHash = reg.hashRoster([g1, g2, g3], threshold);

        // --- attestation (epoch 1) signed by 2 attesters ---
        RosterAttestation memory a = RosterAttestation({
            wallet: address(wal),
            epoch: 1,
            rosterHash: rosterHash,
            guardian0: g1,
            guardian1: g2,
            guardian2: g3,
            threshold: threshold,
            sepoliaBlockNumber: block.number,
            sepoliaBlockHash: blockhash(block.number > 0 ? block.number - 1 : 0),
            validUntil: uint64(block.timestamp + 1 hours)
        });
        bytes32 attDigest = _attDigest(reg, a);
        bytes[] memory attSigs = new bytes[](2);
        attSigs[0] = _sig(vm.envUint("ATTESTER_1_PK"), attDigest);
        attSigs[1] = _sig(vm.envUint("ATTESTER_2_PK"), attDigest);

        // --- recovery digest signed by 2 guardians ---
        RecoveryDigest memory d = RecoveryDigest({
            chainId: block.chainid,
            wallet: address(wal),
            newKey: newKey(),
            ownerEpoch: wal.ownerEpoch(),
            rosterEpoch: 1,
            rosterHash: rosterHash,
            deadline: uint64(block.timestamp + 1 hours),
            requestId: requestId(),
            callHash: keccak256("devnet-call")
        });
        bytes32 wd = _recDigest(wal, d);
        bytes[] memory gsigs = new bytes[](2);
        gsigs[0] = _sig(vm.envUint("GUARDIAN_1_PK"), wd);
        gsigs[1] = _sig(vm.envUint("GUARDIAN_2_PK"), wd);

        vm.startBroadcast(deployerPk);
        reg.submitRoster(a, attSigs);
        wal.requestRecovery(d, gsigs);
        vm.stopBroadcast();

        (address pk, uint64 readyAt,) = wal.pending();
        console.log("recovery requested; pending key:", pk);
        console.log("ready at (unix):", readyAt);
        console.log("new key target :", newKey());
    }

    function finish() external {
        VoxyWallet wal = _wal();
        vm.startBroadcast(vm.envUint("DEVNET_DEPLOYER_PK"));
        wal.executeRecovery();
        vm.stopBroadcast();
        console.log("executed. isOwner(newKey):", wal.isOwner(newKey()));
        console.log("ownerCount:", wal.ownerCount());
    }

    // --- EIP-712 digest helpers (read live domain separators) ---

    function _attDigest(RosterRegistry reg, RosterAttestation memory a) internal view returns (bytes32) {
        bytes32 typehash = keccak256(
            "RosterAttestation(address wallet,uint64 epoch,bytes32 rosterHash,address guardian0,address guardian1,address guardian2,uint8 threshold,uint256 sepoliaBlockNumber,bytes32 sepoliaBlockHash,uint64 validUntil)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash, a.wallet, a.epoch, a.rosterHash, a.guardian0, a.guardian1, a.guardian2, a.threshold, a.sepoliaBlockNumber, a.sepoliaBlockHash, a.validUntil
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", reg.DOMAIN_SEPARATOR(), structHash));
    }

    function _recDigest(VoxyWallet wal, RecoveryDigest memory d) internal view returns (bytes32) {
        bytes32 typehash = keccak256(
            "RecoveryDigest(uint256 chainId,address wallet,address newKey,uint64 ownerEpoch,uint64 rosterEpoch,bytes32 rosterHash,uint64 deadline,bytes32 requestId,bytes32 callHash)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash, d.chainId, d.wallet, d.newKey, d.ownerEpoch, d.rosterEpoch, d.rosterHash, d.deadline, d.requestId, d.callHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", wal.DOMAIN_SEPARATOR(), structHash));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
