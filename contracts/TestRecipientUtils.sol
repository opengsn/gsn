pragma solidity ^0.4.24;

import './RecipientUtils.sol';

contract TestRecipientUtils is RecipientUtils {

    event Unused();
    function testFunc(uint , string , uint , bytes  ) external {
        emit Unused();  //just to avoid warnings..
    }

}