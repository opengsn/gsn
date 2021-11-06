// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;

import "../../../contracts/src/interfaces/IRelayHub.sol";

/**
 * In order to help the Truffle tests to decode events in the transactions' results,
 * the events must be declared in a top-level contract.
 * Implement this empty interface in order to add event signatures to any contract.
 *
 */
interface AllEvents {
    event Received(address indexed sender, uint256 eth);
    event Withdrawal(address indexed src, uint wad);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 ethActualCharge);

    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );


    /// Emitted when an attempt to relay a call fails and Paymaster does not accept the transaction.
    /// The actual relayed call was not executed, and the recipient not charged.
    /// @param reason contains a revert reason returned from preRelayedCall or forwarder.
    event TransactionRejectedByPaymaster(
        address indexed relayManager,
        address indexed paymaster,
        bytes32 indexed relayRequestID,
        address from,
        address to,
        address relayWorker,
        bytes4 selector,
        uint256 innerGasUsed,
        bytes reason
    );

    /// Emitted when a transaction is relayed. Note that the actual encoded function might be reverted: this will be
    /// indicated in the status field.
    /// Useful when monitoring a relay's operation and relayed calls to a contract.
    /// Charge is the ether value deducted from the recipient's balance, paid to the relay's manager.
    event TransactionRelayed(
        address indexed relayManager,
        address indexed relayWorker,
        bytes32 indexed relayRequestID,
        address from,
        address to,
        address paymaster,
        bytes4 selector,
        IRelayHub.RelayCallStatus status,
        uint256 charge
    );

    event TransactionResult(
        IRelayHub.RelayCallStatus status,
        bytes returnValue
    );

    event SampleRecipientEmitted(string message, address realSender, address msgSender, address origin, uint256 msgValue, uint256 gasLeft, uint256 balance);

    event SampleRecipientEmittedSomethingElse(string message);

}
