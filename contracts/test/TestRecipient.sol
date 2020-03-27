/* solhint-disable avoid-tx-origin */
pragma solidity ^0.5.16;

import "../utils/GsnUtils.sol";
import "../BaseRelayRecipient.sol";
import "./TestPaymasterConfigurableMisbehavior.sol";
import "../TrustedForwarder.sol";

contract TestRecipient is BaseRelayRecipient {

    constructor(address forwarder) public {
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

    function() external payable {}

    event SampleRecipientEmitted(string message, address realSender, address msgSender, address origin);

    function emitMessage(string memory message) public {
        if (paymaster != address(0)) {
            withdrawAllBalance();
        }

        emit SampleRecipientEmitted(message, getSender(), msg.sender, tx.origin);
    }

    function withdrawAllBalance() public {
        TestPaymasterConfigurableMisbehavior(paymaster).withdrawAllBalance();
    }

    // solhint-disable-next-line no-empty-blocks
    function dontEmitMessage(string memory message) public {}

    function emitMessageNoParams() public {
        emit SampleRecipientEmitted("Method with no parameters", getSender(), msg.sender, tx.origin);
    }
}
