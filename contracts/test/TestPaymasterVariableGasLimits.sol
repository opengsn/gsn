// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterVariableGasLimits is TestPaymasterEverythingAccepted {

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
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    view
    returns (bytes memory) {
        (relayRequest, approvalData);
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
        GSNTypes.GasData calldata gasData
    )
    external
    override
    relayHubOnly
    {
        (context, success, preRetVal, gasUseWithoutPost, gasData);
        emit SampleRecipientPostCallWithValues(gasleft(), gasUseWithoutPost);
    }
}
