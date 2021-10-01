// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../utils/RLPReader.sol";

import "../bls/BLSBatchGateway.sol";

contract DomainSpecificInputDecompressor {
    using RLPReader for bytes;
    using RLPReader for uint;
    using RLPReader for RLPReader.RLPItem;

    bytes4 constant METHOD_TRANSFER = 0xa9059cbb;
    bytes4 constant METHOD_TRANSFER_FROM = 0x23b872dd;
    bytes4 constant METHOD_BURN = 0x00000000; // signature not currently known
    bytes4 constant METHOD_APPROVE = 0x095ea7b3;

    bytes4[] public methodSignatures;
    address[] public senders;
    address[] public targets;
    address[] public paymasters;

    // note: a length of an array after this value was added (zero indicates 'no value')
    mapping(bytes4 => uint256) public reverseMethodSignatures;
    mapping(address => uint256) public reverseSenders;
    mapping(address => uint256) public reverseTargets;
    mapping(address => uint256) public reversePaymasters;

    // method-specific parameters tables and their reverse maps
    address[] public recipients;
    mapping(address => uint256) public reverseRecipients;

    uint256 constant ARRAY_OFFSET = 8; // RLP ITEMS IN AN ITEM
    uint256 constant ITEM_SIZE = 8; // RLP ITEMS IN AN ITEM
    uint256 constant ID_MAX_VALUE = 0xffffffff;

    /// Decodes the input and stores the values that are encountered for the first time.
    /// @return decodedBatch the Batch struct with all values filled either from input of from the cache
    function decodeBatch(
        bytes calldata encodedBatch
    )
    public
    returns (
        BLSBatchGateway.Batch memory decodedBatch
    ){
        RLPReader.RLPItem[] memory values = encodedBatch.toRlpItem().toList();
        // must convert to an rlpItem first!

        uint256 maxApprovalData = values[0].toUint();
        uint256[2] memory blsSignature = [values[1].toUint(), values[2].toUint()];


        RLPReader.RLPItem[] memory batchRLPItems = values[3].toList();
        RLPReader.RLPItem[] memory approvalsRLPItems = values[4].toList();
        BLSBatchGateway.BatchItem[] memory bi = new BLSBatchGateway.BatchItem[](batchRLPItems.length);
        BLSBatchGateway.ApprovalItem[] memory ai = new BLSBatchGateway.ApprovalItem[](approvalsRLPItems.length);

        for (uint256 i = 0; i < approvalsRLPItems.length; i++) {
            ai[i] = decodeApprovalItem(approvalsRLPItems[i].toList());
        }
        for (uint256 i = 0; i < batchRLPItems.length; i++) {
            bi[i] = decodeBatchItem(batchRLPItems[i].toList());
        }
        return BLSBatchGateway.Batch(bi, ai, [uint256(1), uint256(1)], 0);
    }

    function decodeBatchItem(
        RLPReader.RLPItem[] memory values
    )
    public
    returns (
        BLSBatchGateway.BatchItem memory bi
    ) {
        // 1. read inputs
        uint256 id = values[0].toUint();
        uint256 nonce = values[1].toUint();

        uint256 paymasterId = values[2].toUint();
        uint256 senderId = values[3].toUint();
        uint256 targetId = values[4].toUint();
        uint256 gasLimit = values[5].toUint();
        RLPReader.RLPItem memory methodSignatureItem = values[6];
        bytes memory methodData = values[7].toBytes();

        // 2. resolve values
        bytes4 methodSignature = resolveMethodSignature(methodSignatureItem);

        address paymaster = resolveIdToAddress(paymasters, paymasterId);
        address sender = resolveIdToAddress(senders, senderId);
        address target = resolveIdToAddress(targets, targetId);

        if (methodSignature == METHOD_TRANSFER ||
            methodSignature == METHOD_APPROVE) {
            uint256 value;
            address recipient;
            methodData = abi.encode(recipient, value);
        } else if (methodSignature == METHOD_TRANSFER_FROM) {
            address owner;
            uint256 value;
            address recipient;
        } else if (methodSignature == METHOD_BURN) {
            uint256 value;
        }

        // 3. Store new values into cache
        saveBytes4ToCache(methodSignatures, reverseMethodSignatures, methodSignature);
        saveAddressToCache(paymasters, reversePaymasters, paymaster);
        saveAddressToCache(senders, reverseSenders, sender);
        saveAddressToCache(targets, reverseTargets, target);

        bi = BLSBatchGateway.BatchItem(id, nonce, paymaster, sender, target, methodSignature, methodData, gasLimit);
    }

    function decodeApprovalItem(RLPReader.RLPItem[] memory approvalRLPItem) public view returns (BLSBatchGateway.ApprovalItem memory){
        return BLSBatchGateway.ApprovalItem(address(0), [uint256(1), uint256(1), uint256(1), uint256(1)], '');
    }


    function resolveIdToAddress(address[] storage addressCache, uint256 id) internal view returns (address){
        // SET MAX CACHE SIZE; VALUES BIGGER THAN THAT CONSIDERED ACTUAL INPUT
        if (id > ID_MAX_VALUE) {
            return address(uint160(id));
        } else {
            require(id < addressCache.length, 'address: invalid id');
            return addressCache[id];
        }
        return address(0);
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

    function saveAddressToCache(
        address[] storage addressCache,
        mapping(address => uint256) storage reverseMap,
        address addressToCache
    ) internal {
        if (reverseMap[addressToCache] == 0) {
            addressCache.push(addressToCache);
            reverseMap[addressToCache] = addressCache.length;
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
