pragma solidity ^0.5.5;

import './GsnUtils.sol';
import './RelayHub.sol';

contract TestRecipientUtils {

    event Unused();
    function testFunc(uint , string memory, uint , bytes memory ) public {
        emit Unused();  //just to avoid warnings..
    }

    function registerAsRelay(RelayHub relayhub) public payable {
        relayhub.registerRelay(10, "string memory url");
    }
    function() external payable {}

    /****** these methods are internal in 'GsnUtils' and cannot be accessed from JS *******/

    function getParam(bytes memory msgData, uint index) public pure returns (uint) {
        return GsnUtils.getParam(msgData, index);
    }

    function getMethodSig(bytes memory msgData) public pure returns (bytes4) {
        return GsnUtils.getMethodSig(msgData);
    }
    
    function getBytesParam(bytes memory msgData, uint index) public pure returns (bytes memory ret)  {
        return GsnUtils.getBytesParam(msgData, index);
    }
    function getStringParam(bytes memory msgData, uint index) public pure returns (string memory) {
        return GsnUtils.getStringParam(msgData, index);
    }
}