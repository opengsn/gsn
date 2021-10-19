// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/IBatchGatewayCacheDecoder.sol";

import "../utils/GsnTypes.sol";
import "../utils/RLPReader.sol";

import "./ERC20CacheDecoder.sol";
import "./utils/BLSTypes.sol";
import "./utils/CacheLibrary.sol";

/**
*
*/
contract BatchGatewayCacheDecoder is IBatchGatewayCacheDecoder {
    using RLPReader for bytes;
    using RLPReader for uint;
    using RLPReader for RLPReader.RLPItem;
    using CacheLibrary for BLSTypes.AddressCache;

    address public forwarder;

    BLSTypes.AddressCache private sendersCache;
    BLSTypes.AddressCache private targetsCache;
    BLSTypes.AddressCache private paymastersCache;
    BLSTypes.AddressCache private cacheDecodersCache;

    mapping(bytes4 => uint256) public knownGasLimits;

    constructor(address _forwarder) {
        forwarder = _forwarder;
        // taking over ID 1 for special value (use encodedData as-is)
        cacheDecodersCache.queryAndUpdateCache(type(uint160).max);
    }

    function convertAddressesToIds(
        address[] memory senders,
        address[] memory targets,
        address[] memory paymasters
    )
    external
    override
    view
    returns (
        uint256[] memory sendersID,
        uint256[] memory targetsID,
        uint256[] memory paymastersID
    ){
        return (
        sendersCache.convertAddressesToIdsInternal(senders),
        targetsCache.convertAddressesToIdsInternal(targets),
        paymastersCache.convertAddressesToIdsInternal(paymasters)
        );
    }

    /// Decodes the input and stores the values that are encountered for the first time.
    /// @return decodedBatch the Batch struct with all values filled either from input of from the cache
    function decodeBatch(
        bytes calldata encodedBatch
    )
    public
    returns (
        BLSTypes.Batch memory decodedBatch
    ){
        RLPReader.RLPItem[] memory values = encodedBatch.toRlpItem().toList();
        BLSTypes.BatchMetadata memory batchMetadata;
        batchMetadata.gasPrice = values[0].toUint();
        batchMetadata.validUntil = values[1].toUint();
        batchMetadata.pctRelayFee = values[2].toUint();
        batchMetadata.baseRelayFee = values[3].toUint();
        batchMetadata.maxAcceptanceBudget = values[4].toUint();
        batchMetadata.relayWorker = values[5].toAddress();
        uint256 defaultCacheDecoderId = values[6].toUint();
        batchMetadata.defaultCacheDecoder = cacheDecodersCache.queryAndUpdateCache(defaultCacheDecoderId);

        uint256[2] memory blsSignature = [values[7].toUint(), values[8].toUint()];
        RLPReader.RLPItem[] memory relayRequestsRLPItems = values[9].toList();
        RLPReader.RLPItem[] memory authorizationsRLPItems = values[10].toList();

        uint256[] memory relayRequestsIDs = new uint256[](relayRequestsRLPItems.length);
        GsnTypes.RelayRequest[] memory relayRequests = new GsnTypes.RelayRequest[](relayRequestsRLPItems.length);
        BLSTypes.SignedKeyAuthorization[] memory authorizations = new BLSTypes.SignedKeyAuthorization[](authorizationsRLPItems.length);

        for (uint256 i = 0; i < authorizationsRLPItems.length; i++) {
            authorizations[i] = decodeAuthorizationItem(authorizationsRLPItems[i].toList());
        }
        for (uint256 i = 0; i < relayRequestsRLPItems.length; i++) {
            (relayRequests[i], relayRequestsIDs[i]) = decodeRelayRequests(
                relayRequestsRLPItems[i].toList(),
                batchMetadata
            );
        }
        return BLSTypes.Batch(batchMetadata, authorizations, relayRequests, relayRequestsIDs, blsSignature);
    }

    function decodeRelayRequests(
        RLPReader.RLPItem[] memory values,
        BLSTypes.BatchMetadata memory batchMetadata
    )
    public
    returns (
        GsnTypes.RelayRequest memory,
        uint256 id
    ) {
        // 1. read inputs
        BLSTypes.RelayRequestsElement memory batchElement;
        batchElement.id = values[0].toUint();
        batchElement.nonce = values[1].toUint();
        batchElement.paymaster = values[2].toUint();
        batchElement.sender = values[3].toUint();
        batchElement.target = values[4].toUint();
        batchElement.gasLimit = values[5].toUint();
        batchElement.calldataGas = values[6].toUint();
        batchElement.encodedData = values[7].toBytes();
        batchElement.cacheDecoder = values[8].toUint();

        // 2. resolve values from inputs and cache
        address paymaster = paymastersCache.queryAndUpdateCache(batchElement.paymaster);
        address sender = sendersCache.queryAndUpdateCache(batchElement.sender);
        address target = targetsCache.queryAndUpdateCache(batchElement.target);

        // 3. resolve msgData using a CalldataDecompressor if needed
        bytes memory msgData;
        if (batchElement.cacheDecoder == 0) {
            msgData = ERC20CacheDecoder(batchMetadata.defaultCacheDecoder).decodeCalldata(batchElement.encodedData);
        } else if (batchElement.cacheDecoder == 1) {
            msgData = batchElement.encodedData;
            // TODO: if it is going to copy data again better make a workaround
        } else {
            address decompressor = cacheDecodersCache.queryAndUpdateCache(batchElement.cacheDecoder);
            msgData = ERC20CacheDecoder(decompressor).decodeCalldata(batchElement.encodedData);
        }

        // 4. Fill in values that are optional inputs or computed on-chain and construct a RelayRequest
        return (
        GsnTypes.RelayRequest(
            IForwarder.ForwardRequest(sender, target, 0, batchElement.gasLimit, batchElement.nonce, batchElement.encodedData, batchMetadata.validUntil),
            GsnTypes.RelayData(
                batchMetadata.gasPrice, batchMetadata.pctRelayFee, batchMetadata.baseRelayFee,
                batchElement.calldataGas, batchMetadata.relayWorker, paymaster, forwarder, "", 0)
        ), batchElement.id);
    }

    function decodeAuthorizationItem(RLPReader.RLPItem[] memory authorizationRLPItem) public view returns (BLSTypes.SignedKeyAuthorization memory){
        address sender = authorizationRLPItem[0].toAddress();
        RLPReader.RLPItem[] memory blsPublicKeyItems = authorizationRLPItem[1].toList();
        uint256[4] memory blsPublicKey = [blsPublicKeyItems[0].toUint(), blsPublicKeyItems[1].toUint(), blsPublicKeyItems[2].toUint(), blsPublicKeyItems[3].toUint()];
        bytes memory signature = authorizationRLPItem[2].toBytes();
        return BLSTypes.SignedKeyAuthorization(sender, blsPublicKey, signature);
    }
}
