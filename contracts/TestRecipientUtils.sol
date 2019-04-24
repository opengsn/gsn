pragma solidity >=0.4.0 <0.6.0;

import './RecipientUtils.sol';
import './RelayHub.sol';

contract TestRecipientUtils {

    event Unused();
    function testFunc(uint , string memory, uint , bytes memory ) public {
        emit Unused();  //just to avoid warnings..
    }

    function registerAsRelay(RelayHub relayhub) public payable {
        relayhub.register_relay(10, "string memory url");
    }
    function() external payable {}

    /****** these methods are internal in 'RecipientUtils' and cannot be accessed from JS *******/
    function sig(string memory methodSig) public pure returns (bytes4) {
        return RecipientUtils.sig(methodSig);
    }

    function getParam(bytes memory msg_data, uint index) public pure returns (uint) {
        return RecipientUtils.getParam(msg_data, index);
    }

    function getMethodSig(bytes memory msg_data) public pure returns (bytes4) {
        return RecipientUtils.getMethodSig(msg_data);
    }
    
    function getBytesParam(bytes memory msg_data, uint index) public pure returns (bytes memory ret)  {
        return RecipientUtils.getBytesParam(msg_data, index);
    }
    function getStringParam(bytes memory msg_data, uint index) public pure returns (string memory) {
        return RecipientUtils.getStringParam(msg_data, index);
    }
}