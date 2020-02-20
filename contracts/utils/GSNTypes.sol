pragma solidity ^0.5.16;

library GSNTypes {

    struct CallData {
        address target;
        uint256 gasLimit;
        uint256 gasPrice;
        bytes encodedFunction;
    }

    struct RelayData {
        address senderAccount;
        uint256 senderNonce;
        address relayAddress;
        uint256 pctRelayFee;
        address gasSponsor;
    }

    struct RelayRequest {
        CallData callData;
        RelayData relayData;
    }

    struct SponsorLimits {
        uint256 acceptRelayedCallGasLimit;
        uint256 preRelayCallGasLimit;
        uint256 postRelayCallGasLimit;
    }
}
