// SPDX-License-Identifier:MIT
pragma solidity ^0.7.5;
pragma abicoder v2;

import "../utils/RelayHubValidator.sol";

contract TestRelayHubValidator {

    //for testing purposes, we must be called from a method with same param signature as RelayCall
    function dummyRelayCall(
        uint, //paymasterMaxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint //externalGasLimit
    ) external pure {
        RelayHubValidator.verifyTransactionPacking(relayRequest, signature, approvalData);
    }

    // helper method for verifyTransactionPacking
    function len1(bytes calldata buf) external pure returns (uint) {
        return RelayHubValidator.len1(buf);
    }
}