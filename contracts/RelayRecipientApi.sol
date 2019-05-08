pragma solidity >=0.4.0 <0.6.0;

contract RelayRecipientApi {

    /**
     * return the relayHub of this contract.
     */
    function get_hub_addr() public view returns (address);

    /**
     * return the contract's balance on the RelayHub.
     * can be used to determine if the contract can pay for incoming calls,
     * before making any.
     */
    function get_recipient_balance() public view returns (uint);

    /*
     *  @return "0" if the the contract is willing to accept the charges from this sender, for this function call.
     *      any other value is a failure. actual value is for diagnostics only.
     *** Note :values below 10 are reserved by can_relay
     *  @param relay the relay that attempts to relay this function call.
     *          the contract may restrict some encoded functions to specific known relays.
     *  @param from the sender (signer) of this function call.
     *  @param encoded_function the encoded function call (without any ethereum signature).
     *          the contract may check the method-id for valid methods
     *  @param gas_price - the gas price for this transaction
     *  @param transaction_fee - the relay compensation (in %) for this transaction
     *  @param approval - first 65 bytes are checked by the RelayHub and reserved for the sender's signature, and the rest is
     *           available for dapps in their specific use-cases
     */
    function accept_relayed_call(address relay, address from, bytes memory encoded_function, uint gas_price, uint transaction_fee, bytes memory approval) public view returns (uint32);

    /**
     * This method is called after the relayed call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     * the method is given all parameters of accept_relayed_call, and also the success/failure status and actual used gas.
     * - success - true if the relayed call succeeded, false if it reverted
     * - used_gas - gas used up to this point. Note that gas calculation (for the purpose of compensation
     *   to the relay) is done after this method returns.
     */
    function post_relayed_call(address relay, address from, bytes memory encoded_function, bool success, uint used_gas, uint transaction_fee) public;
}
