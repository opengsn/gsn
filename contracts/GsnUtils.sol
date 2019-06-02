pragma solidity ^0.5.5;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

library GsnUtils {

    /**
     * extract method sig from encoded function call
     */
    function getMethodSig(bytes memory msgData) internal pure returns (bytes4) {
        return bytes4(bytes32(LibBytes.readUint256(msgData, 0)));
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
     * we assume that there ARE dynamic parameters, hence getParam(0) is the offset to the first
     * dynamic param
     * https://solidity.readthedocs.io/en/develop/abi-spec.html#use-of-dynamic-types
     */
    function getBytesParam(bytes memory msgData, uint index) internal pure returns (bytes memory ret)  {
        uint ofs = getParam(msgData,index)+4;
        uint len = LibBytes.readUint256(msgData, ofs);
        ret = LibBytes.slice(msgData, ofs+32, ofs+32+len);
    }

    function getStringParam(bytes memory msgData, uint index) internal pure returns (string memory) {
        return string(getBytesParam(msgData,index));
    }

    function checkSig(address signer, bytes32 hash, bytes memory sig) pure internal returns (bool) {
        // Check if @v,@r,@s are a valid signature of @signer for @hash
        uint8 v = uint8(sig[0]);
        bytes32 r = LibBytes.readBytes32(sig,1);
        bytes32 s = LibBytes.readBytes32(sig,33);
        return signer == ecrecover(hash, v, r, s);
    }
}