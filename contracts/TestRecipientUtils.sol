pragma solidity ^0.5.0;

import './RecipientUtils.sol';

contract TestRecipientUtils is RecipientUtils {

    event Unused();
    function testFunc(uint , string calldata, uint , bytes calldata ) external {
        emit Unused();  //just to avoid warnings..
    }

}