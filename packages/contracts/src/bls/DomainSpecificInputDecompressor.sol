// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../utils/GsnTypes.sol";
import "../utils/RLPReader.sol";

import "./interfaces/IDecompressor.sol";
import "./interfaces/BLSTypes.sol";

contract DomainSpecificInputDecompressor is IDecompressor {
    using RLPReader for bytes;
    using RLPReader for uint;
    using RLPReader for RLPReader.RLPItem;

    address public forwarder;

    bytes4 constant METHOD_TRANSFER = 0xa9059cbb;
    bytes4 constant METHOD_TRANSFER_FROM = 0x23b872dd;
    bytes4 constant METHOD_BURN = 0x00000000; // signature not currently known
    bytes4 constant METHOD_APPROVE = 0x095ea7b3;

    bytes4[] public methodSignatures;
    mapping(bytes4 => uint256) public reverseMethodSignatures;

    struct AddressCache {
        // note: a length of an array after this value was added (zero indicates 'no value')
        mapping(address => uint256) reverse;
        address[] cache;
    }

    AddressCache private sendersCache;
    AddressCache private targetsCache;
    AddressCache private paymastersCache;

    // method-specific parameters
    AddressCache private recipientsCache;

    function convertAddressesToIds(
        address[] memory senders,
        address[] memory targets,
        address[] memory paymasters,
        address[] memory recipients
    )
    external
    view
    returns (
        uint256[] memory sendersID,
        uint256[] memory targetsID,
        uint256[] memory paymastersID,
        uint256[] memory recipientsID
    ){
        return (
        convertAddressesToIdsInternal(sendersCache, senders),
        convertAddressesToIdsInternal(targetsCache, targets),
        convertAddressesToIdsInternal(paymastersCache, paymasters),
        convertAddressesToIdsInternal(recipientsCache, recipients)
        );
    }

    function convertAddressesToIdsInternal(
        AddressCache storage addressCache,
        address[] memory input
    )
    internal
    view
    returns (uint256[] memory ids) {
        ids = new uint256[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            uint256 id = addressCache.reverse[input[i]];
            // In reverse map, IDs are actually "new array lengths", so that 0 means no value cached
            if (id == 0) {
                ids[i] = uint256(uint160(input[i]));
            } else {
                ids[i] = id - 1; // return actual ID as index in an array
            }
        }
    }

    // defines max cache size allowing bigger values to be considered an actual address input
    uint256 constant ADDRESS_ID_MAX_VALUE = 0xffffffff;

    constructor(address _forwarder) {
        forwarder = _forwarder;
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
        batchMetadata.relayWorker = values[2].toAddress();
        batchMetadata.pctRelayFee = values[3].toUint();
        batchMetadata.baseRelayFee = values[4].toUint();
        batchMetadata.maxAcceptanceBudget = values[5].toUint();

        uint256[2] memory blsSignature = [values[6].toUint(), values[7].toUint()];
        RLPReader.RLPItem[] memory relayRequestsRLPItems = values[8].toList();
        RLPReader.RLPItem[] memory authorizationsRLPItems = values[9].toList();

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
        RLPReader.RLPItem memory methodSignatureItem = values[7];
        batchElement.methodData = values[8].toBytes();

        // 2. resolve values
        batchElement.methodSignature = resolveMethodSignature(methodSignatureItem);

        address paymaster = queryAndUpdateCache(paymastersCache, batchElement.paymaster);
        address sender = queryAndUpdateCache(sendersCache, batchElement.sender);
        address target = queryAndUpdateCache(targetsCache, batchElement.target);

        if (batchElement.methodSignature == METHOD_TRANSFER ||
            batchElement.methodSignature == METHOD_APPROVE) {
            uint256 value;
            address recipient;
            batchElement.methodData = abi.encodeWithSelector(batchElement.methodSignature, recipient, value);
        } else if (batchElement.methodSignature == METHOD_TRANSFER_FROM) {
            address owner;
            uint256 value;
            address recipient;
        } else if (batchElement.methodSignature == METHOD_BURN) {
            uint256 value;
        }

        // 3. Store new values into cache
        saveBytes4ToCache(methodSignatures, reverseMethodSignatures, batchElement.methodSignature);

        {
            // 4. Fill in values that are optional inputs or computed on-chain and construct a RelayRequest
            uint256 gas = batchElement.gasLimit == 0 ? knownGasLimits[batchElement.methodSignature] : batchElement.gasLimit;
            require(gas != 0, 'unknown method with unknown gas limit');
            return (
            GsnTypes.RelayRequest(
                IForwarder.ForwardRequest(sender, target, 0, gas, batchElement.nonce, batchElement.methodData, batchMetadata.validUntil),
                GsnTypes.RelayData(
                    batchMetadata.gasPrice, batchMetadata.pctRelayFee, batchMetadata.baseRelayFee,
                    batchElement.calldataGas, batchMetadata.relayWorker, paymaster, forwarder, '', 0)
            ), batchElement.id);
        }
    }

    mapping(bytes4 => uint256) knownGasLimits;

    function decodeAuthorizationItem(RLPReader.RLPItem[] memory authorizationRLPItem) public view returns (BLSTypes.SignedKeyAuthorization memory){
        address sender = authorizationRLPItem[0].toAddress();
        RLPReader.RLPItem[] memory blsPublicKeyItems = authorizationRLPItem[1].toList();
        uint256[4] memory blsPublicKey = [blsPublicKeyItems[0].toUint(), blsPublicKeyItems[1].toUint(), blsPublicKeyItems[2].toUint(), blsPublicKeyItems[3].toUint()];
        bytes memory signature = authorizationRLPItem[2].toBytes();
        return BLSTypes.SignedKeyAuthorization(sender, blsPublicKey, signature);
    }

    function queryAndUpdateCache(
        AddressCache storage addressCache,
        uint256 id
    )
    internal
    returns (address) {
        if (id > ADDRESS_ID_MAX_VALUE) {
            address inputAsAddress = address(uint160(id));
            if (addressCache.reverse[inputAsAddress] == 0) {
                addressCache.cache.push(inputAsAddress);
                addressCache.reverse[inputAsAddress] = addressCache.cache.length;
            }
            return inputAsAddress;
        } else {
            require(id < addressCache.cache.length, 'address: invalid id');
            return addressCache.cache[id];
        }
    }

    /// it is impossible to treat method signature smaller than a certain value as an id because even 0x00000000 is a valid method signature
    /// instead, check if it was encoded as a 4-byte array or a number; client must put zeroes when calling with actual value;
    /// THIS IS PROBLEMATIC, BETTER IDEAS??? It is not very generic/scalable
    /// client must use actual value if its methodSignatureID is >0x00ffffff (indistinguishable)
    function resolveMethodSignature(
        RLPReader.RLPItem memory methodSignatureItem
    ) internal view returns (bytes4){
        if (methodSignatureItem.len == 5) {
            // ?do I understand the RLP encoding correctly?
            // encoding of a full size byte array, even if it contains leading zeroes
            return bytes4(bytes32(methodSignatureItem.toUint()));
        } else {
            uint256 methodSignatureId = methodSignatureItem.toUint();
            require(methodSignatureId < methodSignatures.length, 'methodSig: invalid id');
            return methodSignatures[methodSignatureId];
        }
    }
    /// I don't expect bytes4 will be a common parameter type, but still keeping it generic here.
    function saveBytes4ToCache(
        bytes4[] storage bytes4Cache,
        mapping(bytes4 => uint256) storage reverseMap,
        bytes4 bytes4ToCache
    ) internal {
        if (reverseMap[bytes4ToCache] == 0) {
            bytes4Cache.push(bytes4ToCache);
            reverseMap[bytes4ToCache] = bytes4Cache.length;
        }
    }
}
