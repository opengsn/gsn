pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./TestSponsorEverythingAccepted.sol";

contract TestSponsorStoreContext is TestSponsorEverythingAccepted {

    event SampleRecipientPreCallWithValues(
        address relay,
        address from,
        bytes encodedFunction,
        uint256 transactionFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes approvalData,
        uint256 maxPossibleCharge
    );

    event SampleRecipientPostCallWithValues(
        address relay,
        address from,
        bytes encodedFunction,
        uint256 transactionFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes approvalData,
        uint256 maxPossibleCharge
    );

    /**
     * This demonstrates how acceptRelayedCall can return 'context' data for reuse in preRelayedCall/postRelayedCall.
     */
    function acceptRelayedCall(
        EIP712Sig.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    view
    returns (uint256, bytes memory){
        return (0, abi.encode(
            relayRequest.relayData.relayAddress,
            relayRequest.relayData.senderAccount,
            relayRequest.callData.encodedFunction,
            relayRequest.relayData.pctRelayFee,
            relayRequest.callData.gasPrice,
            relayRequest.callData.gasLimit,
            relayRequest.relayData.senderNonce,
            approvalData,
            maxPossibleCharge));
    }

    function preRelayedCall(bytes calldata context) relayHubOnly external returns (bytes32) {
        (
        address relay, address from, bytes memory encodedFunction,
        uint256 transactionFee, uint256 gasPrice, uint256 gasLimit,
        uint256 nonce, bytes memory approvalData, uint256 maxPossibleCharge) =
            abi.decode(context, (address, address, bytes, uint256, uint256, uint256, uint256, bytes, uint256));
        emit SampleRecipientPreCallWithValues(
            relay, from, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approvalData, maxPossibleCharge);
        return 0;
    }

    function postRelayedCall(
        bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal
    ) relayHubOnly external {
        (
        address relay, address from, bytes memory encodedFunction,
        uint256 transactionFee, uint256 gasPrice, uint256 gasLimit,
        uint256 nonce, bytes memory approvalData, uint256 maxPossibleCharge) =
            abi.decode(context, (address, address, bytes, uint256, uint256, uint256, uint256, bytes, uint256));
        emit SampleRecipientPostCallWithValues(
            relay, from, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approvalData, maxPossibleCharge);
    }
}
