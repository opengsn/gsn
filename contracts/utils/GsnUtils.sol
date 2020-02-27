pragma solidity ^0.5.16;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

import "./GSNTypes.sol";

library GsnUtils {

    /**
     * extract method sig from encoded function call
     */
    function getMethodSig(bytes memory msgData) internal pure returns (bytes4) {
        return LibBytes.readBytes4(msgData, 0);
    }

    /**
     * extract parameter from encoded-function block.
     * see: https://solidity.readthedocs.io/en/develop/abi-spec.html#formal-specification-of-the-encoding
     * note that the type of the parameter must be static.
     * the return value should be casted to the right type.
     */
    function getParam(bytes memory msgData, uint index) internal pure returns (uint) {
        return LibBytes.readUint256(msgData, 4 + index * 32);
    }

    /**
     * extract dynamic-sized (string/bytes) parameter.
     * we assume that there ARE dynamic parameters, hence getBytesParam(0) is the offset to the first
     * dynamic param
     * https://solidity.readthedocs.io/en/develop/abi-spec.html#use-of-dynamic-types
     */
    function getBytesParam(bytes memory msgData, uint index) internal pure returns (bytes memory ret) {
        uint ofs = getParam(msgData, index) + 4;
        uint len = LibBytes.readUint256(msgData, ofs);
        ret = LibBytes.slice(msgData, ofs + 32, ofs + 32 + len);
    }

    function getStringParam(bytes memory msgData, uint index) internal pure returns (string memory) {
        return string(getBytesParam(msgData, index));
    }
}
