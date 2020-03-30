/* solhint-disable no-inline-assembly */
pragma solidity ^0.5.16;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

import "./GSNTypes.sol";

library GsnUtils {

    function getChainID() internal pure returns (uint256) {
        uint256 id;
        assembly {
            id := chainid()
        }
        return id;
    }

    /**
     * extract error string from revert bytes
     */
    function getError(bytes memory err) internal pure returns (string memory ret) {
        if (err.length < 4 + 32) {
            //not a valid revert with error. return as-is.
            return string(err);
        }
        (ret) = abi.decode(LibBytes.slice(err, 4, err.length), (string));
    }

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

    function getAddressParam(bytes memory msgData, uint index) internal pure returns (address) {
        return address(getParam(msgData, index));
    }

    function getBytes32Param(bytes memory msgData, uint index) internal pure returns (bytes32) {
        return bytes32(getParam(msgData, index));
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
