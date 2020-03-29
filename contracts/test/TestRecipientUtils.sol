pragma solidity ^0.5.16;

import "../utils/GsnUtils.sol";
import "../interfaces/IRelayHub.sol";

contract TestRecipientUtils {

    event Unused();
    function testFunc(uint, string memory, uint, bytes memory) public {
        emit Unused();  //just to avoid warnings..
    }

    function() external payable {}

    /****** these methods are internal in 'GsnUtils' and cannot be accessed from JS *******/

    function getParam(bytes memory msgData, uint index) public pure returns (uint) {
        return GsnUtils.getParam(msgData, index);
    }

    function getMethodSig(bytes memory msgData) public pure returns (bytes4) {
        return GsnUtils.getMethodSig(msgData);
    }

    function getBytesParam(bytes memory msgData, uint index) public pure returns (bytes memory ret) {
        return GsnUtils.getBytesParam(msgData, index);
    }
    function getStringParam(bytes memory msgData, uint index) public pure returns (string memory) {
        return GsnUtils.getStringParam(msgData, index);
    }
}
