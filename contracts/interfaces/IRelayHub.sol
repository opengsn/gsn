pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../utils/EIP712Sig.sol";

interface IRelayHub {

    // Emitted when a relay's stake or unstakeDelay are increased
    event Staked(
        address indexed relay,
        uint256 stake,
        uint256 unstakeDelay
    );

    // Emitted when a relay is registered or re-registered. Looking at these events (and filtering out RelayRemoved
    // events) lets a client discover the list of available relays.
    event RelayAdded(
        address indexed relay,
        address indexed owner,
        uint256 transactionFee,
        uint256 stake,
        uint256 unstakeDelay,
        string url
    );

    // Emitted when a relay is removed (deregistered). unstakeTime is the time when unstake will be callable.
    event RelayRemoved(
        address indexed relay,
        uint256 unstakeTime
    );

    // Emitted when a relay is unstaked for, including the returned stake.
    event Unstaked(
        address indexed relay,
        uint256 stake
    );

    // Emitted when an account withdraws funds from RelayHub.
    event Withdrawn(
        address indexed account,
        address indexed dest,
        uint256 amount
    );

    // Emitted when depositFor is called, including the amount and account that was funded.
    event Deposited(
        address indexed sponsor,
        address indexed from,
        uint256 amount
    );

    // Emitted when an attempt to relay a call failed. This can happen due to incorrect relayCall arguments, or the
    // recipient not accepting the relayed call.
    // The actual relayed call was not executed, and the recipient not charged.
    // The reason field contains an error code: values 1-10 correspond to PreconditionCheck entries, and values over 10
    // are custom recipient error codes returned from acceptRelayedCall.
    event CanRelayFailed(
        address indexed relay,
        address indexed from,
        address indexed to,
        address sponsor,
        bytes4 selector,
        uint256 reason);

    // Emitted when a transaction is relayed. Note that the actual encoded function might be reverted: this will be
    // indicated in the status field.
    // Useful when monitoring a relay's operation and relayed calls to a contract.
    // Charge is the ether value deducted from the recipient's balance, paid to the relay's owner.
    event TransactionRelayed(
        address indexed relay,
        address indexed from,
        address indexed to,
        address sponsor,
        bytes4 selector,
        RelayCallStatus status,
        uint256 charge);

    event Penalized(
        address indexed relay,
        address sender,
        uint256 amount
    );

    /// Reason error codes for the TransactionRelayed event
    /// @param OK - the transaction was successfully relayed and execution successful - never included in the event
    /// @param RelayedCallFailed - the transaction was relayed, but the relayed call failed
    /// @param PreRelayedFailed - the transaction was not relayed due to preRelatedCall reverting
    /// @param PostRelayedFailed - the transaction was relayed and reverted due to postRelatedCall reverting
    /// @param RecipientBalanceChanged - the transaction was relayed and reverted due to the recipient balance change
    enum RelayCallStatus {
        OK,
        RelayedCallFailed,
        PreRelayedFailed,
        PostRelayedFailed,
        RecipientBalanceChanged
    }

    /// States a relay can be in
    /// @param Unknown - the relay is unknown to the system: it has never been staked for
    /// @param Staked - the relay has been staked for, but it is not yet active
    /// @param Registered - the relay has registered itself, and is active (can relay calls)
    /// @param Removed - the relay has been removed by its owner and can no longer relay calls.
    ///         It must wait for its unstake delay to elapse before it can unstake
    enum RelayState {
        Unknown,
        Staked,
        Registered,
        Removed

    }

    /// Preconditions for relaying, checked by canRelay and returned as the corresponding numeric values.
    /// @param OK - all checks passed, the call can be relayed
    /// @param WrongSignature - the transaction to relay is not signed by requested sender
    /// @param WrongNonce - the provided nonce has already been used by the sender
    /// @param AcceptRelayedCallReverted - the recipient rejected this call via acceptRelayedCall
    /// @param InvalidRecipientStatusCode - the recipient returned an invalid (reserved) status code
    enum PreconditionCheck {
        OK,
        WrongSignature,
        WrongNonce,
        AcceptRelayedCallReverted,
        InvalidRecipientStatusCode
    }

    // Add stake to a relay and sets its unstakeDelay.
    // If the relay does not exist, it is created, and the caller
    // of this function becomes its owner. If the relay already exists, only the owner can call this function. A relay
    // cannot be its own owner.
    // All Ether in this function call will be added to the relay's stake.
    // Its unstake delay will be assigned to unstakeDelay, but the new value must be greater or equal to the current one
    // Emits a Staked event.
    function stake(address relayaddr, uint256 unstakeDelay) external payable;


    // Registers the caller as a relay.
    // The relay must be staked for, and not be a contract (i.e. this function must be called directly from an EOA).
    // Emits a RelayAdded event.
    // This function can be called multiple times, emitting new RelayAdded events. Note that the received transactionFee
    // is not enforced by relayCall.
    function registerRelay(uint256 transactionFee, string calldata url) external;


    // Removes (deregisters) a relay. Unregistered (but staked for) relays can also be removed. Can only be called by
    // the owner of the relay. After the relay's unstakeDelay has elapsed, unstake will be callable.
    // Emits a RelayRemoved event.
    function removeRelayByOwner(address relay) external;


    // Deletes the relay from the system, and gives back its stake to the owner. Can only be called by the relay owner,
    // after unstakeDelay has elapsed since removeRelayByOwner was called.
    // Emits an Unstaked event.
    function unstake(address relay) external;



    // Returns a relay's status. Note that relays can be deleted when unstaked or penalized.
    function getRelay(address relay)
    external
    view
    returns (uint256 totalStake, uint256 unstakeDelay, uint256 unstakeTime, address payable owner, RelayState state);

    // Balance management

    // Deposits ether for a contract, so that it can receive (and pay for) relayed transactions. Unused balance can only
    // be withdrawn by the contract itself, by calling withdraw.
    // Emits a Deposited event.
    function depositFor(address target) external payable;


    // Returns an account's deposits. These can be either a contract's funds, or a relay owner's revenue.
    function balanceOf(address target) external view returns (uint256);

    // Withdraws from an account's balance, sending it back to it. Relay owners call this to retrieve their revenue, and
    // contracts can also use it to reduce their funding.
    // Emits a Withdrawn event.
    function withdraw(uint256 amount, address payable dest) external;


    // Relaying

    // Check if the RelayHub will accept a relayed operation. Multiple things must be true for this to happen:
    //  - all arguments must be signed for by the sender (from)
    //  - the sender's nonce must be the current one
    //  - the recipient must accept this transaction (via acceptRelayedCall)
    // Returns a PreconditionCheck value (OK when the transaction can be relayed), or a recipient-specific error code if
    // it returns one in acceptRelayedCall.
    function canRelay(
        GSNTypes.RelayRequest calldata relayRequest,
        uint256 maxPossibleGas,
        uint256 acceptRelayedCallGasLimit,
        bytes calldata signature,
        bytes calldata approvalData
    )
    external
    returns (uint256 status, bytes memory recipientContext);

    /// Relays a transaction. For this to succeed, multiple conditions must be met:
    ///  - canRelay must return PreconditionCheck.OK
    ///  - the sender must be a registered relay
    ///  - the transaction's gas price must be larger or equal to the one that was requested by the sender
    ///  - the transaction must have enough gas to run all internal transactions if they use all gas available to them
    ///  - the sponsor must have enough balance to pay the relay for the scenario when all gas is spent
    ///
    /// If all conditions are met, the call will be relayed and the recipient charged.
    ///
    /// Arguments:
    /// @param relayRequest - all details of the requested relay call
    /// @param signature - client's signature over all previous params, plus the relay and RelayHub addresses
    /// @param approvalData: dapp-specific data forwarded to acceptRelayedCall.
    ///        This value is *not* verified by the Hub. For example, it can be used to pass a signature to the sponsor.
    ///
    /// Emits a TransactionRelayed event.
    function relayCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    ) external;

    function dryRun(address from, address target, bytes calldata encodedFunction, uint gasLimit)
    external returns (bool success, string memory err);

    // Relay penalization. Any account can penalize relays, removing them from the system immediately, and rewarding the
    // reporter with half of the relay's stake. The other half is burned so that, even if the relay penalizes itself, it
    // still loses half of its stake.

    // Penalize a relay that signed two transactions using the same nonce (making only the first one valid) and
    // different data (gas price, gas limit, etc. may be different). The (unsigned) transaction data and signature for
    // both transactions must be provided.
    function penalizeRepeatedNonce(
        bytes calldata unsignedTx1,
        bytes calldata signature1,
        bytes calldata unsignedTx2,
        bytes calldata signature2)
    external;

    // Penalize a relay that sent a transaction that didn't target RelayHub's registerRelay or relayCall.
    function penalizeIllegalTransaction(bytes calldata unsignedTx, bytes calldata signature) external;

    function getNonce(address from) external view returns (uint256);

    function getHubOverhead() external view returns (uint256);

    function calculateCharge(uint256 gas, uint256 gasPrice, uint256 fee) external view returns (uint256);
}

