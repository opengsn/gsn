// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterVariableGasLimits is TestPaymasterEverythingAccepted {

    string public override versionPaymaster = "2.0.0-alpha.1+opengsn.test-vgl.ipaymaster";

    event SampleRecipientPreCallWithValues(
        uint256 gasleft,
        uint256 maxPossibleGas
    );

    event SampleRecipientPostCallWithValues(
        uint256 gasleft,
        uint256 gasUseWithoutPost
    );

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    returns (bytes memory, bool) {
        (relayRequest, approvalData);
        emit SampleRecipientPreCallWithValues(
            gasleft(), maxPossibleGas);
        return ("", false);
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    relayHubOnly
    {
        (context, success, gasUseWithoutPost, relayData);
        emit SampleRecipientPostCallWithValues(gasleft(), gasUseWithoutPost);
    }
}
