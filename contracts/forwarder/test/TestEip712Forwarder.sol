// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../Eip712Forwarder.sol";

// helper class for testing the forwarder.
contract TestEip712Forwarder {
    function callVerifyAndCall(Eip712Forwarder forwarder, Eip712Forwarder.ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public {

        (bool success, bytes memory ret) = forwarder.verifyAndCall(req, domainSeparator, requestTypeHash, suffixData, sig);
        string memory error;
        if ( !success )
            error = this.decodeErrorMessage(ret);
        emit Result(success, ret, error);
    }

    event Result(bool success, bytes ret, string error);

    function decodeErrorMessage(bytes calldata ret) external pure returns (string memory message) {
        if ( ret.length>4+32 )
            return abi.decode(ret[4:], (string));
    }
}
