pragma solidity ^0.5.16;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

import "./BaseGsnAware.sol";

/**
 * A base class to be inherited by a concrete Relay Recipient
 * A subclass must use "getSender()" instead of "msg.sender"
 */
contract BaseRelayRecipient is BaseGsnAware {

    /*
     * modifier to be used by recipients as access control protection for preRelayedCall & postRelayedCall
     */
    modifier relayHubOnly() {
        require(msg.sender == address(relayHub), "Function can only be called by RelayHub");
        _;
    }

    /**
     * return the sender of this call.
     * if the call came through the valid RelayHub, return the original sender.
     * otherwise, return `msg.sender`
     * should be used in the contract anywhere instead of msg.sender
     */
    function getSender() public view returns (address) {
        if (msg.sender == address(relayHub)) {
            // At this point we know that the sender is a trusted IRelayHub,
            // so we trust that the last bytes of msg.data are the verified sender address.
            // extract sender address from the end of msg.data
            return LibBytes.readAddress(msg.data, msg.data.length - 20);
        }
        return msg.sender;
    }
}
