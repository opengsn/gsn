pragma solidity >=0.4.0 <0.6.0;

import './RecipientUtils.sol';
import './RelayHub.sol';

contract TestRecipientUtils is RecipientUtils {

    event Unused();
    function testFunc(uint , string memory, uint , bytes memory ) public {
        emit Unused();  //just to avoid warnings..
    }

    function registerAsRelay(RelayHub relayhub) public payable {
        relayhub.register_relay(10, "string memory url");
    }
    function() external payable {}
}