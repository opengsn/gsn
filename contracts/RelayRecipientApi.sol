pragma solidity ^0.5.0;

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
}
