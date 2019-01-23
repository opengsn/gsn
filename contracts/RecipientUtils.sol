pragma solidity >=0.4.0 <0.6.0;

contract RecipientUtils {

    //return the signature of a method.
    // (can also be done off-chain)
    function sig(string memory methodSig) public pure returns (bytes4) {
        return bytes4(keccak256(bytes(methodSig)));
    }

    /**
     * extract method sig from encoded function call
     */
    function getMethodSig(bytes memory msg_data) public pure returns (bytes4) {
        return bytes4(bytes32(extractUint(msg_data, 0)));
    }

    /**
     * extract parameter from encoded-function block.
     * see: https://solidity.readthedocs.io/en/develop/abi-spec.html#formal-specification-of-the-encoding
     * note that the type of the parameter must be static.
     * the return value should be casted to the right type.
     */
    function getParam(bytes memory msg_data, uint index) public pure returns (uint) {
        return extractUint(msg_data, 4 + index * 32);
    }

    /**
     * extract dynamic-sized (string/bytes) parameter.
     * we assume that there ARE dynamic parameters, hence getParam(0) is the offset to the first
     * dynamic param
     * https://solidity.readthedocs.io/en/develop/abi-spec.html#use-of-dynamic-types
     */
    function getBytesParam(bytes memory msg_data, uint index) public pure returns (bytes memory ret)  {
        uint ofs = getParam(msg_data,index)+4;
        uint len = extractUint(msg_data, ofs);
        ret = extractBytes(msg_data, ofs+32, len);
    }

    function getStringParam(bytes memory msg_data, uint index) public pure returns (string memory) {
        return string(getBytesParam(msg_data,index));
    }


    /**
     * extract bytes32 block from a memory source.
     * if offset is too large, then pad result with zeros.
     * @param source a block of memory to extract from.
     * @param ofs offset to start.
     */
    function extractUint(bytes memory source, uint ofs) public pure returns (uint result) {
        assembly {
            result := mload(add(ofs, add(source, 32)))
        }
    }

    //extracts bytes from a memory block
    function extractBytes(bytes memory source, uint ofs, uint len) public pure returns (bytes memory ret) {
        //TODO: check overflows (not really needed. it will exhaust gas on overflows)
        require( ofs+len <= source.length, "asdasd");
        //TODO: assembly?
        ret = new bytes(len);
        for ( uint i=0; i<len; i++ ) {
            ret[i] = source[i+ofs];
        }
    }
}