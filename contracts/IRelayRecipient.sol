pragma solidity ^0.5.5;

contract IRelayRecipient {

    /**
     * return the relayHub of this contract.
     */
    function getHubAddr() public view returns (address);

    /**
     * return the contract's balance on the RelayHub.
     * can be used to determine if the contract can pay for incoming calls,
     * before making any.
     */
    function getRecipientBalance() public view returns (uint);

    /*
     * Called by Relay (and RelayHub), to validate if this recipient accepts this call.
     * Note: Accepting this call means paying for the tx whether the relayed call reverted or not.
     *
     *  @return "0" if the the contract is willing to accept the charges from this sender, for this function call.
     *      any other value is a failure. actual value is for diagnostics only.
     *      ** Note: values below 10 are reserved by canRelay

     *  @param relay the relay that attempts to relay this function call.
     *          the contract may restrict some encoded functions to specific known relays.
     *  @param from the sender (signer) of this function call.
     *  @param encodedFunction the encoded function call (without any ethereum signature).
     *          the contract may check the method-id for valid methods
     *  @param gasPrice - the gas price for this transaction
     *  @param transactionFee - the relay compensation (in %) for this transaction
     *  @param approval - first 65 bytes are checked by the RelayHub and reserved for the sender's signature, and the rest is
     *           available for dapps in their specific use-cases
     */
    function acceptRelayedCall(address relay, address from, bytes memory encodedFunction, uint gasPrice, uint transactionFee, bytes memory approval) public view returns (uint);

    /** this method is called before the actual relayed function call.
     * It may be used to charge the caller before (in conjuction with refunding him later in postRelayedCall for example).
     * the method is given all parameters of acceptRelayedCall and actual used gas.
     *
     *
     *** NOTICE: if this method modifies the contract's state, it must be protected with access control i.e. require msg.sender == getHubAddr()
     *
     *
     * Revert in this functions causes a revert of the client's relayed call but not in the entire transaction
     * (that is, the relay will still get compensated)
     */
    function preRelayedCall(address relay, address from, bytes memory encodedFunction, uint transactionFee) public returns (bytes32);

    /** this method is called after the actual relayed function call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     * the method is given all parameters of acceptRelayedCall, and also the success/failure status and actual used gas.
     *
     *
     *** NOTICE: if this method modifies the contract's state, it must be protected with access control i.e. require msg.sender == getHubAddr()
     *
     *
     * @param success - true if the relayed call succeeded, false if it reverted
     * @param usedGas - gas used up to this point. The recipient may use this information to perform local booking and
     *   charge the sender for this call (e.g. in tokens).
     * @param preRetVal - preRelayedCall() return value passed back to the recipient
     *
     * Revert in this functions causes a revert of the client's relayed call but not in the entire transaction
     * (that is, the relay will still get compensated)
     */
    function postRelayedCall(address relay, address from, bytes memory encodedFunction, bool success, uint usedGas, uint transactionFee, bytes32 preRetVal) public;

}
