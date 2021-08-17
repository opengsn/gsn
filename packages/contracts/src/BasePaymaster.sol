// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./AbstractPaymaster.sol";

/**
 * Base contract to be inherited by a concrete Paymaster
 *
 * A subclass must implement:
 *  - preRelayedCall - provide logic to validate the request, and revert if the paymaster refuse to pay.
 *  - postRelayedCall - provide logic after the call, (e.g. charge the caller by some contract logic) for this call.
 */
abstract contract BasePaymaster is AbstractPaymaster, Ownable {

    function setRelayHub(IRelayHub hub) public onlyOwner {
        _setRelayHub(hub);
    }

    function setTrustedForwarder(address forwarder) public virtual onlyOwner {
        __setTrustedForwarder(forwarder);
    }

    function withdrawRelayHubDepositTo(uint amount, address payable target) public onlyOwner {
        _withdrawRelayHubDepositTo(amount, target);
    }
}
