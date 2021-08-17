// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../../BaseRelayRecipient.sol";

contract TestForwarderTarget is BaseRelayRecipient {

    string public override versionRecipient = "2.2.3+opengsn.test.recipient";

    constructor(address forwarder) {
        _setTrustedForwarder(forwarder);
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    event TestForwarderMessage(string message, bytes realMsgData, address realSender, address msgSender, address origin);

    function emitMessage(string memory message) public {

        // solhint-disable-next-line avoid-tx-origin
        emit TestForwarderMessage(message, _msgData(), _msgSender(), msg.sender, tx.origin);
    }

    function publicMsgSender() public view returns (address) {
        return _msgSender();
    }

    function publicMsgData() public view returns (bytes memory) {
        return _msgData();
    }

    function mustReceiveEth(uint value) public payable {
        require( msg.value == value, "didn't receive value");
    }

    event Reverting(string message);

    function testRevert() public {
        require(address(this) == address(0), "always fail");
        emit Reverting("if you see this revert failed...");
    }
}
