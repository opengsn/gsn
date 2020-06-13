// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "../forwarder/Eip712Forwarder.sol";

//TODO: not am interface anymore, but just a container of request type..
interface GsnTypes {

    struct RelayData {
        uint256 gasPrice;
        uint256 pctRelayFee;
        uint256 baseRelayFee;
        address relayWorker;
        address paymaster;
    }

    struct ExtraData {
        address forwarder;
        bytes32 domainSeparator;
    }

    //note: must start with the ForwardRequest to be an extension of the generic forwarder
    struct RelayRequest {
        IForwarder.ForwardRequest request;
        RelayData relayData;
        // extra request data, not part of the signed struct
        ExtraData extraData;
    }
}
