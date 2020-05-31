// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

interface ISignatureVerifier{

    struct GasData {
        uint256 gasLimit;
        uint256 gasPrice;
        uint256 pctRelayFee;
        uint256 baseRelayFee;
    }

    struct RelayData {
        address senderAddress;
        uint256 senderNonce;
        address relayWorker;
        address paymaster;
        address forwarder;
    }

    struct RelayRequest {
        address target;
        bytes encodedFunction;
        GasData gasData;
        RelayData relayData;
    }

    function verify(RelayRequest calldata req, bytes calldata signature) external view returns (bool);

    function versionSM() external view returns (string memory);
}
