pragma solidity >=0.4.0 <0.6.0;

// Contract that implements the relay recipient protocol.  Inherited by Gatekeeper, or any other relay recipient.
//
// The recipient contract is responsible to:
// * pass a trusted RelayHubApi singleton to the constructor.
// * Implement accept_relayed_call, which acts as a whitelist/blacklist of senders.  It is advised that the recipient's owner will be able to update that list to remove abusers.
// * In every function that cares about the sender, use "address sender = get_sender()" instead of msg.sender.  It'll return msg.sender for non-relayed transactions, or the real sender in case of relayed transactions.

import "./RelayRecipientApi.sol";
import "./RelayHubApi.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";

contract RelayRecipient is RelayRecipientApi {

    RelayHubApi private relay_hub; // The RelayHubApi singleton which is allowed to call us

	function get_hub_addr() public view returns (address) {
		return address(relay_hub);
	}

    /**
     * initialize the RelayHubApi.
     * contracts usually call this method from the constructor (using a constract RelayHubApi, or receiving
     * one in the constructor)
     * This method might also be called by the owner, in order to use a new RelayHubApi - since the RelayHubApi
     * itself is not an upgradable contract.
     */
    function init_relay_hub(RelayHubApi _rhub) internal {
        require(relay_hub == RelayHubApi(0), "init_relay_hub: rhub already set");
        set_relay_hub(_rhub);
    }

    function set_relay_hub(RelayHubApi _rhub) internal {
        // Normally called just once, during init_relay_hub.
        // Left as a separate internal function, in case a contract wishes to have its own update mechanism for RelayHubApi.
        relay_hub = _rhub;

        //attempt a read method, just to validate the relay is a valid RelayHubApi contract.
        get_recipient_balance();
    }

    function get_relay_hub() internal view returns (RelayHubApi) {
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
            // At this point we know that the sender is a trusted RelayHubApi, so we trust that the last bytes of msg.data are the verified sender address.
            // extract sender address from the end of msg.data
            sender = LibBytes.readAddress(msg_data, msg_data.length - 20);
        }
        return sender;
    }

    function get_sender() public view returns(address) {
        return get_sender_from_data(msg.sender, msg.data);
    }

    function get_message_data() public view returns(bytes memory) {
        bytes memory orig_msg_data = msg.data;
        if (msg.sender == get_hub_addr()) {
            // At this point we know that the sender is a trusted RelayHubApi, so we trust that the last bytes of msg.data are the verified sender address.
            // extract original message data from the start of msg.data
            orig_msg_data = new bytes(msg.data.length - 20);
            for (uint256 i = 0; i < orig_msg_data.length; i++)
            {
                orig_msg_data[i] = msg.data[i];
            }
        }
        return orig_msg_data;
    }
}

