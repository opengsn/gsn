pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterStoreContext is TestPaymasterEverythingAccepted {

    event SampleRecipientPreCallWithValues(
        address relay,
        address from,
        bytes encodedFunction,
        uint256 baseRelayFee,
        uint256 pctRelayFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes approvalData,
        uint256 maxPossibleGas
    );

    event SampleRecipientPostCallWithValues(
        address relay,
        address from,
        bytes encodedFunction,
        uint256 baseRelayFee,
        uint256 pctRelayFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes approvalData,
        uint256 maxPossibleGas
    );

    /**
     * This demonstrates how acceptRelayedCall can return 'context' data for reuse in preRelayedCall/postRelayedCall.
     */
    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    view
    returns (bytes memory) {
        return abi.encode(
            relayRequest.relayData.relayWorker,
            relayRequest.relayData.senderAddress,
            relayRequest.encodedFunction,
            relayRequest.gasData.baseRelayFee,
            relayRequest.gasData.pctRelayFee,
            relayRequest.gasData.gasPrice,
            relayRequest.gasData.gasLimit,
            relayRequest.relayData.senderNonce,
            approvalData,
            maxPossibleGas);
    }

    function preRelayedCall(bytes calldata context) external relayHubOnly returns (bytes32) {
        (
        address relay, address from, bytes memory encodedFunction,
        uint256 baseRelayFee, uint256 pctRelayFee, uint256 gasPrice, uint256 gasLimit,
        uint256 nonce, bytes memory approvalData, uint256 maxPossibleGas) =
            abi.decode(context, (address, address, bytes, uint256, uint256, uint256, uint256, uint256, bytes, uint256));
        emit SampleRecipientPreCallWithValues(
            relay, from, encodedFunction, baseRelayFee, pctRelayFee,
                gasPrice, gasLimit, nonce, approvalData, maxPossibleGas);
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
        (
        address relay, address from, bytes memory encodedFunction,
        uint256 baseRelayFee, uint256 pctRelayFee, uint256 gasPrice, uint256 gasLimit,
        uint256 nonce, bytes memory approvalData, uint256 maxPossibleGas) =
            abi.decode(context, (address, address, bytes, uint256, uint256, uint256, uint256, uint256, bytes, uint256));
        emit SampleRecipientPostCallWithValues(
            relay, from, encodedFunction, baseRelayFee, pctRelayFee, gasPrice,
            gasLimit, nonce, approvalData, maxPossibleGas);
    }
}
