pragma solidity ^0.5.5;

contract IRelayHub {

    // status flags for TransactionRelayed() event
    enum RelayCallStatus {OK, CanRelayFailed, RelayedCallFailed, PreRelayedFailed, PostRelayedFailed}

    // Preconditions for relaying, checked by canRelay and returned as the corresponding numeric values.
    enum PreconditionCheck {
        OK,                         // All checks passed, the call can be relayed
        WrongSignature,             // The transaction to relay is not signed by requested sender
        WrongNonce,                 // The provided nonce has already been used by the sender
        AcceptRelayedCallReverted   // The recipient rejected this call via acceptRelayedCall
    }

    event Staked(address indexed relay, uint256 stake);
    event Unstaked(address indexed relay, uint256 stake);

    /* RelayAdded is emitted whenever a relay [re-]registers with the RelayHub.
     * filtering on these events (and filtering out RelayRemoved events) lets the client
     * find which relays are currently registered.
     */
    event RelayAdded(address indexed relay, address indexed owner, uint256 transactionFee, uint256 stake, uint256 unstakeDelay, string url);

    // emitted when a relay is removed
    event RelayRemoved(address indexed relay, uint256 unstakeTime);

    /**
     * this events is emitted whenever a transaction is relayed.
     * notice that the actual function call on the target contract might be reverted - in that case, the "success"
     * flag will be set to false.
     * the client uses this event so it can report correctly transaction complete (or revert) to the application.
     * Monitoring tools can use this event to detect liveliness of clients and relays.
     * Field chargeOrCanRelayStatus is the charge deducted from recipient's balance that is paid to the relay except for one case: when canRelay() failed.
     * Whenever canRelay() failed, TransactionRelayed emits its status instead of charge, as the recipient is never charged anyway at that point.
     */
    event TransactionRelayed(address indexed relay, address indexed from, address indexed to, bytes4 selector, uint256 status, uint256 chargeOrCanRelayStatus);
    event Deposited(address src, uint256 amount);
    event Withdrawn(address dest, uint256 amount);
    event Penalized(address indexed relay, address sender, uint256 amount);

    function getNonce(address from) view external returns (uint256);

    function relayCall(address from, address to, bytes memory encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes memory approval) public;

    /**
     * deposit ether for a contract.
     * This ether will be used to repay relay calls into this contract.
     * Contract owner should monitor the balance of his contract, and make sure
     * to deposit more, otherwise the contract won't be able to receive relayed calls.
     * Unused deposited can be withdrawn with `withdraw()`
     */
    function depositFor(address target) public payable;

    function balanceOf(address target) external view returns (uint256);

    /**
     * add stake for the given relay.
     * The caller of this method is the relay owner.
     * the value of this method is added to the current stake of this relay.
     *
     * @param relayaddr the relay to add stake for.
     * @param unstakeDelay - the minimum time before the owner can unstake this relay. This number can be increased,
     *          but neven decreased for a given relay.
     */
    function stake(address relayaddr, uint256 unstakeDelay) external payable;

    function stakeOf(address relayaddr) external view returns (uint256);

    function ownerOf(address relayaddr) external view returns (address);

    /**
     * move the relay's stake (after its unstakeDelay) to the owner.
     * must be called by the relay's owner
     */
    function unstake(address _relay) public;

    /**
     * withdraw funds.
     * caller is either a relay owner, withdrawing collected transaction fees.
     * or a IRelayRecipient contract, withdrawing its deposit.
     * note that while everyone can `depositFor()` a contract, only
     * the contract itself can withdraw its funds.
     *
     * So in order to be able to withdraw its own deposited funds, a contract MUST call this method
     * (from an owner-only method)
     */
    function withdraw(uint256 amount) public;
}

