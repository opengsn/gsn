// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../Eip712Forwarder.sol";

// helper class for testing the forwarder.
contract TestEip712Forwarder {
    function callVerifyAndCall(Eip712Forwarder forwarder, Eip712Forwarder.ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public {
        (bool success, string memory error) = forwarder.execute(req, domainSeparator, requestTypeHash, suffixData, sig);
        emit Result(success, error);
    }

    event Result(bool success, string error);
}
