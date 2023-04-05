/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../utils/GsnUtils.sol";
import "../ERC2771Recipient.sol";
import "./TestPaymasterConfigurableMisbehavior.sol";

contract TestRecipient is ERC2771Recipient {

    constructor(address forwarder) {
        _setTrustedForwarder(forwarder);
    }

    // testing inner call gas estimation
    uint256 private nothing1;
    uint256 private nothing2;
    uint256 private nothing3;
    // solhint-disable-next-line no-complex-fallback
    fallback() external payable {
        nothing1 = type(uint256).max;
        nothing2 = type(uint256).max;
        nothing3 = type(uint256).max;
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

    event SampleRecipientEmitted(string message, address realSender, address msgSender, address origin, uint256 msgValue, uint256 gasLeft, uint256 balance);

    function recipientRevert() public {
        revert("this method reverts consistently");
    }

    function emitMessage(string memory message) public payable returns (string memory) {
        uint256 gasLeft = gasleft();
        if (paymaster != address(0)) {
            withdrawAllBalance();
        }

        emit SampleRecipientEmitted(message, _msgSender(), msg.sender, tx.origin, msg.value, gasLeft, address(this).balance);
        return "emitMessage return value";
    }

    function withdrawAllBalance() public {
        TestPaymasterConfigurableMisbehavior(paymaster).withdrawAllBalance();
    }

    // solhint-disable-next-line no-empty-blocks
    function dontEmitMessage(string calldata message) public {}

    function emitMessageNoParams() public {
        emit SampleRecipientEmitted("Method with no parameters", _msgSender(), msg.sender, tx.origin, 0, gasleft(), address(this).balance);
    }

    //return (or revert) with a string in the given length
    function checkReturnValues(uint256 len, bool doRevert) public view returns (string memory) {
        (this);
        string memory mesg = "this is a long message that we are going to return a small part from. we don't use a loop since we want a fixed gas usage of the method itself.";
        require( bytes(mesg).length>=len, "invalid len: too large");

        /* solhint-disable no-inline-assembly */
        //cut the msg at that length
        assembly { mstore(mesg, len) }
        require(!doRevert, mesg);
        return mesg;
    }

    //function with no return value (also test revert with no msg.
    function checkNoReturnValues(bool doRevert) public view {
        (this);
        /* solhint-disable reason-string*/
        require(!doRevert);
    }

    function withdrawFromSingletonWhitelistPaymaster(address payable singletonPaymaster) public {
        TestRecipient(singletonPaymaster).withdrawBalance(1);
    }

    // only here for one method sig
    // solhint-disable-next-line no-empty-blocks
    function withdrawBalance(uint256 amount) public {}
}
