import "../interfaces/IRelayHub.sol";

contract TestAllEventsDeclarations {
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
