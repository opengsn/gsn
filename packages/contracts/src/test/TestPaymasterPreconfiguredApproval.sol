// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterPreconfiguredApproval is TestPaymasterEverythingAccepted {

    bytes public expectedApprovalData;

    function setExpectedApprovalData(bytes memory val) public {
        expectedApprovalData = val;
    }

    function _verifyApprovalData(bytes calldata approvalData) internal override view {
        require(keccak256(expectedApprovalData) == keccak256(approvalData),
            string(abi.encodePacked(
                "test: unexpected approvalData: '", approvalData, "' instead of '", expectedApprovalData, "'")));
    }

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    view
    override
    returns (bytes memory, bool) {
        (relayRequest, signature, approvalData, maxPossibleGas);
        return ("",false);
    }
}
