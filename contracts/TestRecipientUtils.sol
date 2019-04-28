pragma solidity >=0.4.0 <0.6.0;

import './GsnUtils.sol';
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

    /****** these methods are internal in 'GsnUtils' and cannot be accessed from JS *******/

    function getParam(bytes memory msg_data, uint index) public pure returns (uint) {
        return GsnUtils.getParam(msg_data, index);
    }

    function getMethodSig(bytes memory msg_data) public pure returns (bytes4) {
        return GsnUtils.getMethodSig(msg_data);
    }
    
    function getBytesParam(bytes memory msg_data, uint index) public pure returns (bytes memory ret)  {
        return GsnUtils.getBytesParam(msg_data, index);
    }
    function getStringParam(bytes memory msg_data, uint index) public pure returns (string memory) {
        return GsnUtils.getStringParam(msg_data, index);
    }
}