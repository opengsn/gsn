// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;

import "./IRelayHub.sol";

/**
 * @title The Penalizer Interface
 * @notice In some cases the behavior of a Relay Server may be found to be illegal.
 * It is the responsibility of a `Penalizer` contract to judge whether there was a penalizable event.
 *
 * @notice In case there was, the `Penalizer` will direct the `RelayHub` to slash the stake of the faulty Relay Server.
 */
interface IPenalizer is IERC165 {

    /// @notice Emitted once the reporter submits the first step in the commit-reveal process.
    event CommitAdded(address indexed sender, bytes32 indexed commitHash, uint256 readyBlockNumber);

    struct Transaction {
        uint256 nonce;
        uint256 gasLimit;
        address to;
        uint256 value;
        bytes data;
    }

    /**
     * @notice Called by the reporter as the first step in the commit-reveal process.
     * Any sender can call it to make sure no-one can front-run it to claim this penalization.
     * @param commitHash The hash of the report of a penalizable behaviour the reporter wants to reveal.
     * Calculated as `commit(keccak(encodedPenalizeFunction))`.
     */
    function commit(bytes32 commitHash) external;

    /**
     * @notice Called by the reporter as the second step in the commit-reveal process.
     * If a Relay Worker attacked the system by signing multiple transactions with same nonce so only one is accepted,
     * anyone can grab both transactions from the blockchain and submit them here.
     * Check whether `unsignedTx1` != `unsignedTx2`, that both are signed by the same address,
     * and that `unsignedTx1.nonce` == `unsignedTx2.nonce`.
     * If all conditions are met, relay is considered an "offending relay".
     * The offending relay will be unregistered immediately, its stake will be forfeited and given
     * to the address who reported it (the `msg.sender`), thus incentivizing anyone to report offending relays.
     */
    function penalizeRepeatedNonce(
        bytes calldata unsignedTx1,
        bytes calldata signature1,
        bytes calldata unsignedTx2,
        bytes calldata signature2,
        IRelayHub hub,
        uint256 randomValue
    ) external;

    /**
     * @notice Called by the reporter as the second step in the commit-reveal process.
     * The Relay Workers are not allowed to make calls other than to the `relayCall` method.
     */
    function penalizeIllegalTransaction(
        bytes calldata unsignedTx,
        bytes calldata signature,
        IRelayHub hub,
        uint256 randomValue
    ) external;

    /// @return a SemVer-compliant version of the `Penalizer` contract.
    function versionPenalizer() external view returns (string memory);

    /// @return The minimum delay between commit and reveal steps.
    function getPenalizeBlockDelay() external view returns (uint256);

    /// @return The maximum delay between commit and reveal steps.
    function getPenalizeBlockExpiration() external view returns (uint256);
}
