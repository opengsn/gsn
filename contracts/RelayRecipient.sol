pragma solidity ^0.4.18;

// Contract that implements the relay recipient protocol.  Inherited by Gatekeeper, or any other relay recipient.
//
// The recipient contract is responsible to:
// * pass a trusted RelayHub singleton to the constructor.
// * Implement may_relay, which acts as a whitelist/blacklist of senders.  It is advised that the recipient's owner will be able to update that list to remove abusers.
// * In every function that cares about the sender, use "address sender = get_sender()" instead of msg.sender.  It'll return msg.sender for non-relayed transactions, or the real sender in case of relayed transactions.

import "./RelayRecipientApi.sol";
import "./RelayHub.sol";

contract RelayRecipient is RelayRecipientApi {

    // DO NOT CHANGE - SHOULD ALWAYS BE FIRST MEMBER: This is the address to which we delegatecall() from proxy
    address place_holder;

    address relay_hub; // The RelayHub singleton which is allowed to call us

	function get_relay_hub() external view returns (address) {
		return relay_hub;
	}

    function init_relay_hub(address _rhub) internal {
        require(relay_hub == address(0), "init_relay_hub: rhub already set");
        set_relay_hub_internal(_rhub);
    }

    function set_relay_hub_internal(address _rhub) internal {
        // Normally called just once, during init_relay_hub.
        // Left as a separate internal function, in case a contract wishes to have its own update mechanism for RelayHub.
        relay_hub = _rhub;
    }

    function get_sender_from_data(address orig_sender, bytes msg_data) public view returns(address) {
        address sender = orig_sender;
        if (orig_sender == relay_hub) {
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

    function get_message_data() public view returns(bytes) {
        bytes memory orig_msg_data = msg.data;
        if (msg.sender == relay_hub) {
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

	//Contract must inherit and re-implement this method.
	// return "0" if the the contract is willing to accept the charges from this sender, for this transaction.
	// 	any other value is a failure. actual value is for diagnostics only.
	//  values below 10 are reserved by can_relay
	// @param relay the relay that attempts to relay this function call. 
	//			the contract may restrict some encoded functions to specific known relays.
	// @param from the sender (signer) of this function call. 
	// @param encoded_function the encoded function call (without any signature). 
	//			the contract may check the method signature for valid methods
    function may_relay(address /* relay */, address from, bytes /* encoded_function */) public view returns(uint32) {
        // Inherited and implemented by the recipient contract.  Returns 0 if it's willing to accept the charges of this sender, for that transaction.
		// any other value is failure
        require(msg.sender != from); // Just to prevent a warning
        return 99;
    }

    function bytesToAddress(bytes b) private pure returns (address addr) {
        assembly {
            addr := mload(add(b,20))
        }
    }
}

