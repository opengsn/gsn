// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
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
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    view
    returns (bytes memory) {
        (signature);
        return abi.encode(
            relayRequest.relayData.relayWorker,
            relayRequest.request.from,
            relayRequest.request.data,
            relayRequest.relayData.baseRelayFee,
            relayRequest.relayData.pctRelayFee,
            relayRequest.relayData.gasPrice,
            relayRequest.request.gas,
            relayRequest.request.nonce,
            approvalData,
            maxPossibleGas);
    }

    function preRelayedCall(bytes calldata context)
    external
    override
    relayHubOnly
    returns (bytes32) {
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
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    relayHubOnly
    {
        (context, success, preRetVal, gasUseWithoutPost, relayData);
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
