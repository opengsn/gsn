pragma solidity ^0.5.16;

import "./interfaces/IRelayHub.sol";

/**
 * Shared base-class of BasePaymaster and BaseRelayRecipient
 * required, so that a single contract can implement both, and still have a single
 * referenced relayHub.
 */
contract BaseGsnAware {

    /// The RelayHub singleton that is allowed to call us
    IRelayHub internal relayHub;

    function getHubAddr() public view returns (address) {
        return address(relayHub);
    }
}
