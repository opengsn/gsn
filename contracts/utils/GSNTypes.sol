pragma solidity ^0.5.16;

library GSNTypes {

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
    }

    struct RelayRequest {
        address target;
        bytes encodedFunction;
        GasData gasData;
        RelayData relayData;
    }

    struct GasLimits {
        uint256 acceptRelayedCallGasLimit;
        uint256 preRelayedCallGasLimit;
        uint256 postRelayedCallGasLimit;
    }
}
