pragma solidity >=0.4.0 <0.6.0;

// Contract that implements the relay recipient protocol.  Inherited by Gatekeeper, or any other relay recipient.
//
// The recipient contract is responsible to:
// * pass a trusted RelayHub singleton to the constructor.
// * Implement accept_relayed_call, which acts as a whitelist/blacklist of senders.  It is advised that the recipient's owner will be able to update that list to remove abusers.
// * In every function that cares about the sender, use "address sender = get_sender()" instead of msg.sender.  It'll return msg.sender for non-relayed transactions, or the real sender in case of relayed transactions.

import "./RelayRecipientApi.sol";
import "./RelayHub.sol";

contract RelayRecipient is RelayRecipientApi {

    RelayHub private relay_hub; // The RelayHub singleton which is allowed to call us

	function get_hub_addr() public view returns (address) {
		return address(relay_hub);
	}

    /**
     * initialize the relayhub.
     * contracts usually call this method from the constructor (using a constract RelayHub, or receiving
     * one in the constructor)
     * This method might also be called by the owner, in order to use a new RelayHub - since the RelayHub
     * itself is not an upgradable contract.
     */
    function init_relay_hub(RelayHub _rhub) internal {
        require(relay_hub == RelayHub(0), "init_relay_hub: rhub already set");
        set_relay_hub(_rhub);
    }
    
    function set_relay_hub(RelayHub _rhub) internal {
        // Normally called just once, during init_relay_hub.
        // Left as a separate internal function, in case a contract wishes to have its own update mechanism for RelayHub.
        relay_hub = _rhub;

        //attempt a read method, just to validate the relay is a valid RelayHub contract.
        get_recipient_balance();
    }

    function get_relay_hub() internal view returns (RelayHub) {
        return relay_hub;
    }

    /**
     * return the balance of this contract.
     * Note that this method will revert on configuration error (invalid relay address)
     */
    function get_recipient_balance() public view returns (uint) {
        return get_relay_hub().balanceOf(address(this));
    }

    function get_sender_from_data(address orig_sender, bytes memory msg_data) public view returns(address) {
        address sender = orig_sender;
        if (orig_sender == get_hub_addr() ) {
            // At this point we know that the sender is a trusted RelayHub, so we trust that the last bytes of msg.data are the verified sender address.
            // extract sender address from the end of msg.data
            bytes memory from = new bytes(20);
            for (uint256 i = 0; i < from.length; i++)
            {
                from[i] = msg_data[msg_data.length - from.length + i];
            }
            sender = bytesToAddress(from);
        }
        return sender;
    }

    function get_sender() public view returns(address) {
        return get_sender_from_data(msg.sender, msg.data);
    }

    function get_message_data() public view returns(bytes memory) {
        bytes memory orig_msg_data = msg.data;
        if (msg.sender == get_hub_addr()) {
            // At this point we know that the sender is a trusted RelayHub, so we trust that the last bytes of msg.data are the verified sender address.
            // extract original message data from the start of msg.data
            orig_msg_data = new bytes(msg.data.length - 20);
            for (uint256 i = 0; i < orig_msg_data.length; i++)
            {
                orig_msg_data[i] = msg.data[i];
            }
        }
        return orig_msg_data;
    }

    /*
	 * Contract must inherit and re-implement this method.
	 *  @return "0" if the the contract is willing to accept the charges from this sender, for this function call.
	 *  	any other value is a failure. actual value is for diagnostics only.
	 *   values below 10 are reserved by can_relay
	 *  @param relay the relay that attempts to relay this function call.
	 * 			the contract may restrict some encoded functions to specific known relays.
	 *  @param from the sender (signer) of this function call.
	 *  @param encoded_function the encoded function call (without any ethereum signature).
	 * 			the contract may check the method-id for valid methods
	 *  @param gas_price - the gas price for this transaction
	 *  @param transaction_fee - the relay compensation (in %) for this transaction
	 */
    function accept_relayed_call(address relay, address from, bytes memory encoded_function, uint gas_price, uint transaction_fee ) public view returns(uint32);

    /**
     * This method is called after the relayed call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     * the method is given all parameters of accept_relayed_call, and also the success/failure status and actual used gas.
     * - success - true if the relayed call succeeded, false if it reverted
     * - used_gas - gas used up to this point. Note that gas calculation (for the purpose of compensation
     *   to the relay) is done after this method returns.
     */
    function post_relayed_call(address relay, address from, bytes memory encoded_function, bool success, uint used_gas, uint transaction_fee ) public;

    function bytesToAddress(bytes memory b) private pure returns (address addr) {
        assembly {
            addr := mload(add(b,20))
        }
    }
}

