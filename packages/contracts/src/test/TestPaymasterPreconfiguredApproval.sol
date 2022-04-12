// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterPreconfiguredApproval is TestPaymasterEverythingAccepted {

    bytes public expectedApprovalData;

    function setExpectedApprovalData(bytes memory val) public {
        expectedApprovalData = val;
    }

    // solhint-disable-next-line no-empty-blocks
    function _verifyApprovalData(bytes calldata) internal override view {}

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
        require(keccak256(expectedApprovalData) == keccak256(approvalData),
            string(abi.encodePacked(
                "test: unexpected approvalData: '", approvalData, "' instead of '", expectedApprovalData, "'")));
        return ("",false);
    }
}
