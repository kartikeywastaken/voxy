// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Voxy's own guardian source — the fallback for users/guardians WITHOUT ENS.
///
/// It implements the same `readRoster(account)` shape as the ENSv2-backed `RosterPublisher`, so it
/// is a drop-in `IGuardianSource` for `VoxyWallet` / `VoxyWalletFrame` / `VoxyDelegate`: recovery
/// works identically whether the roster comes from ENS or from here. Each account self-configures
/// its own guardians (plain addresses — no `.eth` required) and can revoke one INSTANTLY (an
/// owner-path strengthening, consistent with Voxy's asymmetric-timing rule). Revoked or expired
/// slots read back as `address(0)` — fail-closed, exactly like a lapsed ENS name.
///
/// Design note: this EXTENDS Voxy to the ENS-less; it does not replace ENS. ENS stays the preferred
/// source (portable, cross-app identity); this is the source you use when you don't have a name.
contract VoxyGuardianRegistry {
    struct Roster {
        address[3] guardians;
        uint8 threshold;
        uint64 expiresAt; // 0 = never expires
    }

    mapping(address => Roster) private _rosters;
    mapping(address => mapping(address => bool)) public revoked; // account => guardian => revoked

    event GuardiansSet(address indexed account, address[3] guardians, uint8 threshold, uint64 expiresAt);
    event GuardianRevoked(address indexed account, address guardian);
    event GuardianRestored(address indexed account, address guardian);

    /// Configure the caller's own guardian roster. `threshold` must be 1..3; empty slots are
    /// `address(0)`. Re-calling replaces the roster and clears prior revocations for cleanliness.
    function setGuardians(address[3] calldata guardians, uint8 threshold, uint64 expiresAt) external {
        require(threshold >= 1 && threshold <= 3, "bad threshold");
        uint8 nonEmpty;
        for (uint256 i = 0; i < 3; i++) {
            if (guardians[i] != address(0)) {
                nonEmpty++;
                // clear any stale revocation on a freshly-set guardian
                if (revoked[msg.sender][guardians[i]]) revoked[msg.sender][guardians[i]] = false;
            }
        }
        require(threshold <= nonEmpty, "threshold exceeds guardians");
        _rosters[msg.sender] = Roster({guardians: guardians, threshold: threshold, expiresAt: expiresAt});
        emit GuardiansSet(msg.sender, guardians, threshold, expiresAt);
    }

    /// Instantly revoke one of the caller's guardians (no attester sync, no delay).
    function revoke(address guardian) external {
        revoked[msg.sender][guardian] = true;
        emit GuardianRevoked(msg.sender, guardian);
    }

    function restore(address guardian) external {
        revoked[msg.sender][guardian] = false;
        emit GuardianRestored(msg.sender, guardian);
    }

    /// Drop-in with `IRosterSource.readRoster`: returns the active guardians (revoked/expired slots
    /// zeroed, fail-closed), the threshold, and the roster expiry.
    function readRoster(address account)
        external
        view
        returns (address[3] memory guardians, uint8 threshold, uint64 expiresAt)
    {
        Roster memory r = _rosters[account];
        bool expired = r.expiresAt != 0 && block.timestamp >= r.expiresAt;
        for (uint256 i = 0; i < 3; i++) {
            address g = r.guardians[i];
            guardians[i] = (expired || g == address(0) || revoked[account][g]) ? address(0) : g;
        }
        return (guardians, r.threshold, r.expiresAt);
    }

    function rosterOf(address account) external view returns (Roster memory) {
        return _rosters[account];
    }
}
