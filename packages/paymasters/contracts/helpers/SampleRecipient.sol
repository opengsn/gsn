//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/BaseRelayRecipient.sol";

// pass-through paymaster.
// should override it and re-implement acceptRelayedCall. use "super" on success
contract SampleRecipient is BaseRelayRecipient {
    string public override versionRecipient = "2.2.3+opengsn.sample.irelayrecipient";

    event Sender( address _msgSenderFunc, address sender );

    function setForwarder(address forwarder) public {
        _setTrustedForwarder(forwarder);
    }
    function something() public {
        emit Sender( _msgSender(), msg.sender );
    }
}
