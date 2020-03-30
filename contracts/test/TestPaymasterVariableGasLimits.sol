pragma solidity ^0.5.16;
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
    view
    returns (bytes memory) {
        (relayRequest, approvalData);
        return abi.encode(
            gasleft(),
            maxPossibleGas);
    }

    function preRelayedCall(bytes calldata context) external relayHubOnly returns (bytes32) {
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
    relayHubOnly
    {
        (context, success, preRetVal, gasUseWithoutPost, gasData);
        emit SampleRecipientPostCallWithValues(gasleft(), gasUseWithoutPost);
    }
}
