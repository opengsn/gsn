pragma solidity ^0.5.16;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

import "./BaseGsnAware.sol";
import "./interfaces/IRelayRecipient.sol";

/**
 * A base class to be inherited by a concrete Relay Recipient
 * A subclass must use "getSender()" instead of "msg.sender"
 */
contract BaseRelayRecipient is IRelayRecipient {

    /// the TrustedForwarder singleton we accept calls from.
    // we trust it to verify the caller's signature, and pass the caller's address as last 20 bytes
    address internal trustedForwarder;

    /*
     * require a function to be called through GSN only
     */
    modifier trustedForwarderOnly() {
        require(msg.sender == address(trustedForwarder), "Function can only be called through trustedForwarder");
        _;
    }

    function getTrustedForwarder() public view returns(address) {
        return trustedForwarder;
    }

    /**
     * return the sender of this call.
     * if the call came through our trusted forwarder, return the original sender.
     * otherwise, return `msg.sender`
     * should be used in the contract anywhere instead of msg.sender
     */
    function getSender() internal view returns (address) {
        if (msg.sender == address(getTrustedForwarder())) {
            // At this point we know that the sender is a trusted forwarder,
            // so we trust that the last bytes of msg.data are the verified sender address.
            // extract sender address from the end of msg.data
            return LibBytes.readAddress(msg.data, msg.data.length - 20);
        }
        return msg.sender;
    }
}
