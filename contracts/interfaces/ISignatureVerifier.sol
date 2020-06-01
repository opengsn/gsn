// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

interface ISignatureVerifier{

    struct GasData {
        uint256 gasPrice;
        uint256 pctRelayFee;
        uint256 baseRelayFee;
    }

    struct RelayData {
        address relayWorker;
        address paymaster;
    }

    //note: must start with the generic forwarder fields
    struct RelayRequest {
        address target;
        bytes encodedFunction;
        address senderAddress;
        uint256 senderNonce;
        uint256 gasLimit;
        address forwarder;
        GasData gasData;
        RelayData relayData;
    }

    function verify(RelayRequest calldata req, bytes calldata signature) external view returns (bool);

    function versionSM() external view returns (string memory);
}
