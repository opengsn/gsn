// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterVariableGasLimits is TestPaymasterEverythingAccepted {

    string public override versionPaymaster = "2.0.0-alpha.1+opengsn.test-vgl.ipaymaster";

    event SampleRecipientPreCallWithValues(
        uint256 gasleft,
        uint256 arcGasleft,
        uint256 maxPossibleGas
    );

    event SampleRecipientPostCallWithValues(
        uint256 gasleft,
        uint256 gasUseWithoutPost
    );

    function acceptRelayedCall(
        GsnTypes.RelayRequest memory relayRequest,
        bytes memory signature,
        bytes memory approvalData,
        uint256 maxPossibleGas
    )
    public
    override
    view
    returns (bytes memory) {
        (relayRequest, signature, approvalData);
        return abi.encode(
            gasleft(),
            maxPossibleGas);
    }

    function preRelayedCall(bytes calldata context)
    external
    override
    relayHubOnly
    returns (bytes32) {
        (
        uint256 arcGasleft, uint256 maxPossibleGas) =
            abi.decode(context, (uint256, uint256));
        emit SampleRecipientPreCallWithValues(
            gasleft(), arcGasleft, maxPossibleGas);
        return 0;
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        bytes32 preRetVal,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    relayHubOnly
    {
        (context, success, preRetVal, gasUseWithoutPost, relayData);
        emit SampleRecipientPostCallWithValues(gasleft(), gasUseWithoutPost);
    }
}
