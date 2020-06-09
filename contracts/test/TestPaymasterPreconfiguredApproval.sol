// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterPreconfiguredApproval is TestPaymasterEverythingAccepted {

    bytes public expectedApprovalData;

    function setExpectedApprovalData(bytes memory val) public {
        expectedApprovalData = val;
    }

    function acceptRelayedCall(
        ISignatureVerifier.RelayRequest memory relayRequest,
        bytes memory signature,
        bytes memory approvalData,
        uint256 maxPossibleGas
    )
    public
    override
    view
    returns (bytes memory) {
        (relayRequest, signature, approvalData, maxPossibleGas);
        require(keccak256(expectedApprovalData) == keccak256(approvalData),
            string(abi.encodePacked(
                "test: unexpected approvalData: '", approvalData, "' instead of '", expectedApprovalData, "'")));
        return "";
    }
}
