// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../../utils/GsnTypes.sol";

interface BLSTypes {
    struct SignedKeyAuthorization {
        address from;
        uint256[4] blsPublicKey;
        bytes signature;
    }

    struct RelayRequestsElement {
        uint256 id;
        uint256 nonce;
        uint256 paymaster;
        uint256 sender;
        uint256 target;
        uint256 gasLimit;
        uint256 calldataGas;
//        bytes4 methodSignature;
        bytes encodedData;
        // 0 - use default one; 1 - use encodedData as-is; other - use as ID;
        uint256 cacheDecoder;
    }

    struct BatchMetadata {
        uint256 gasPrice;
        uint256 validUntil;
        uint256 pctRelayFee;
        uint256 baseRelayFee;
        uint256 maxAcceptanceBudget;
        address relayWorker;
        address defaultCacheDecoder;
    }

    struct Batch {
        BatchMetadata metadata;
        SignedKeyAuthorization[] authorizations;
        GsnTypes.RelayRequest[] relayRequests;
        uint256[] relayRequestIds;
        uint256[2] blsSignature;
    }

}
