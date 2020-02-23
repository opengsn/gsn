pragma solidity ^0.5.16;

library GSNTypes {

    struct GasData {
        uint256 gasLimit;
        uint256 gasPrice;
        uint256 pctRelayFee;
        uint256 baseRelayFee;
    }

    struct RelayData {
        address senderAccount;
        uint256 senderNonce;
        address relayAddress;
        address gasSponsor;
    }

    struct RelayRequest {
        address target;
        bytes encodedFunction;
        GasData gasData;
        RelayData relayData;
    }

    struct SponsorLimits {
        uint256 acceptRelayedCallGasLimit;
        uint256 preRelayCallGasLimit;
        uint256 postRelayCallGasLimit;
    }
}
