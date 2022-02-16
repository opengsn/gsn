// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../utils/RelayHubValidator.sol";

contract TestRelayHubValidator {

    //for testing purposes, we must be called from a method with same param signature as RelayCall
    function dummyRelayCall(
        uint256, //paymasterMaxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    ) external pure {
        RelayHubValidator.verifyTransactionPacking(relayRequest, signature, approvalData);
    }

    // helper method for verifyTransactionPacking
    function dynamicParamSize(bytes calldata buf) external pure returns (uint256) {
        return RelayHubValidator.dynamicParamSize(buf);
    }
}
