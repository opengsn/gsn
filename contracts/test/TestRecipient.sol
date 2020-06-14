/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "../utils/GsnUtils.sol";
import "../BaseRelayRecipient.sol";
import "./TestPaymasterConfigurableMisbehavior.sol";
import "../interfaces/IKnowForwarderAddress.sol";

contract TestRecipient is BaseRelayRecipient, IKnowForwarderAddress {

    string public override versionRecipient = "2.0.0-alpha.1+opengsn.test.irelayrecipient";

    constructor(address forwarder) public {
        setTrustedForwarder(forwarder);
    }

    function getTrustedForwarder() public override view returns(address) {
        return trustedForwarder;
    }

    function setTrustedForwarder(address forwarder) internal {
        trustedForwarder = forwarder;
    }

    event Reverting(string message);

    function testRevert() public {
        require(address(this) == address(0), "always fail");
        emit Reverting("if you see this revert failed...");
    }

    address payable public paymaster;

    function setWithdrawDuringRelayedCall(address payable _paymaster) public {
        paymaster = _paymaster;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    event SampleRecipientEmitted(string message, address realSender, address msgSender, address origin, uint256 value);

    function emitMessage(string memory message) public payable {
        if (paymaster != address(0)) {
            withdrawAllBalance();
        }

        emit SampleRecipientEmitted(message, _msgSender(), msg.sender, tx.origin, address(this).balance);
    }

    function withdrawAllBalance() public {
        TestPaymasterConfigurableMisbehavior(paymaster).withdrawAllBalance();
    }

    // solhint-disable-next-line no-empty-blocks
    function dontEmitMessage(string memory message) public {}

    function emitMessageNoParams() public {
        emit SampleRecipientEmitted("Method with no parameters", _msgSender(), msg.sender, tx.origin, address(this).balance);
    }
}
