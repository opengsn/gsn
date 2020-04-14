pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../utils/EIP712Sig.sol";

interface IRelayHub {


    /// Emitted when a relay server registers or updates its details
    /// Looking at these events lets a client discover relay servers
    event RelayServerRegistered(
        address indexed relayManager,
        uint256 baseRelayFee,
        uint256 pctRelayFee,
        string url);

    /// Emitted when relays are added by a relayManager
    event RelayWorkersAdded(
        address indexed relayManager,
        address[] newRelayWorkers,
        uint256 workersCount
    );

    // Emitted when an account withdraws funds from RelayHub.
    event Withdrawn(
        address indexed account,
        address indexed dest,
        uint256 amount
    );

    // Emitted when depositFor is called, including the amount and account that was funded.
    event Deposited(
        address indexed paymaster,
        address indexed from,
        uint256 amount
    );

    // Emitted when an attempt to relay a call failed. This can happen due to incorrect relayCall arguments, or the
    // recipient not accepting the relayed call.
    // The actual relayed call was not executed, and the recipient not charged.
    // The reason field contains an error code: values 1-10 correspond to CanRelayStatus entries, and values over 10
    // are custom recipient error codes returned from acceptRelayedCall.
    event CanRelayFailed(
        address indexed relayManager,
        address indexed relayWorker,
        address indexed from,
        address to,
        address paymaster,
        bytes4 selector,
        string reason);

    // Emitted when a transaction is relayed. Note that the actual encoded function might be reverted: this will be
    // indicated in the status field.
    // Useful when monitoring a relay's operation and relayed calls to a contract.
    // Charge is the ether value deducted from the recipient's balance, paid to the relay's manager.
    event TransactionRelayed(
        address indexed relayManager,
        address indexed relayWorker,
        address indexed from,
        address to,
        address paymaster,
        bytes4 selector,
        RelayCallStatus status,
        uint256 charge);

    event Penalized(
        address indexed relayWorker,
        address sender,
        uint256 reward
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

    //return the stake manager of this RelayHub
    function getStakeManager() external view returns(address);

    /// Add new worker addresses controlled by sender who must be a staked Relay Manager address.
    /// Emits a RelayWorkersAdded event.
    /// This function can be called multiple times, emitting new events
    function addRelayWorkers(address[] calldata newRelayWorkers) external;

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external;

    // Balance management

    // Deposits ether for a contract, so that it can receive (and pay for) relayed transactions. Unused balance can only
    // be withdrawn by the contract itself, by calling withdraw.
    // Emits a Deposited event.
    function depositFor(address target) external payable;


    // Returns an account's deposits. These can be either a contract's funds, or a relay manager's revenue.
    function balanceOf(address target) external view returns (uint256);

    // Withdraws from an account's balance, sending it back to it. Relay managers call this to retrieve their revenue, and
    // contracts can also use it to reduce their funding.
    // Emits a Withdrawn event.
    function withdraw(uint256 amount, address payable dest) external;

    // Relaying

    // Check if the RelayHub will accept a relayed operation. Multiple things must be true for this to happen:
    //  - all arguments must be signed for by the sender (from)
    //  - the sender's nonce must be the current one
    //  - the recipient must accept this transaction (via acceptRelayedCall)
    // Returns true on success (and recipient context), or false with error string
    // it returns one in acceptRelayedCall.
    function canRelay(
        GSNTypes.RelayRequest calldata relayRequest,
        uint256 maxPossibleGas,
        uint256 acceptRelayedCallGasLimit,
        bytes calldata signature,
        bytes calldata approvalData
    )
    external
    view
    returns (bool success, string memory returnValue);

    /// Relays a transaction. For this to succeed, multiple conditions must be met:
    ///  - canRelay must return CanRelayStatus.OK
    ///  - the sender must be a registered relayWorker
    ///  - the transaction's gas price must be larger or equal to the one that was requested by the sender
    ///  - the transaction must have enough gas to run all internal transactions if they use all gas available to them
    ///  - the sponsor must have enough balance to pay the relayWorker for the scenario when all gas is spent
    ///
    /// If all conditions are met, the call will be relayed and the recipient charged.
    ///
    /// Arguments:
    /// @param relayRequest - all details of the requested relayWorker call
    /// @param signature - client's signature over all previous params, plus the relayWorker and RelayHub addresses
    /// @param approvalData: dapp-specific data forwarded to acceptRelayedCall.
    ///        This value is *not* verified by the Hub. For example, it can be used to pass a signature to the sponsor.
    ///
    /// Emits a TransactionRelayed event.
    function relayCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    ) external;

    // Relay penalization. Any account can penalize relays, removing them from the system immediately, and rewarding the
    // reporter with half of the relayWorker's stake. The other half is burned so that, even if the relayWorker penalizes itself, it
    // still loses half of its stake.

    // Penalize a relayWorker that signed two transactions using the same nonce (making only the first one valid) and
    // different data (gas price, gas limit, etc. may be different). The (unsigned) transaction data and signature for
    // both transactions must be provided.
    /*function penalizeRepeatedNonce(
        bytes calldata unsignedTx1,
        bytes calldata signature1,
        bytes calldata unsignedTx2,
        bytes calldata signature2)
    external;

    // Penalize a relayWorker that sent a transaction that didn't target RelayHub's registerRelay or relayCall.
    function penalizeIllegalTransaction(bytes calldata unsignedTx, bytes calldata signature) external;
*/
    function penalize(address relayWorker, address payable beneficiary) external;

    function getHubOverhead() external view returns (uint256);

    /// The fee is expressed as a base fee in wei plus percentage on actual charge.
    /// E.g. a value of 40 stands for a 40% fee, so the recipient will be
    /// charged for 1.4 times the spent amount.
    function calculateCharge(uint256 gasUsed, GSNTypes.GasData calldata gasData) external view returns (uint256);

    function getVersion() external view returns (string memory);

}

