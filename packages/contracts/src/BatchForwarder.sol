// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./forwarder/Forwarder.sol";
import "./BaseRelayRecipient.sol";
import "./utils/GsnUtils.sol";

/**
 * batch forwarder support calling a method sendBatch in the forwarder itself.
 * NOTE: the "target" of the request should be the BatchForwarder itself
 */
contract BatchForwarder is Forwarder, BaseRelayRecipient {

    string public override versionRecipient = "2.2.3+opengsn.batched.irelayrecipient";

    constructor() {
        //needed for sendBatch
        _setTrustedForwarder(address(this));
    }

    function sendBatch(address[] calldata targets, bytes[] calldata encodedFunctions) external {
        require(targets.length == encodedFunctions.length, "BatchForwarder: wrong length");
        address sender = _msgSender();
        for (uint i = 0; i < targets.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory ret) = targets[i].call(abi.encodePacked(encodedFunctions[i], sender));
            if (!success){
                //re-throw the revert with the same revert reason.
                GsnUtils.revertWithData(ret);
            }
        }
    }
}
