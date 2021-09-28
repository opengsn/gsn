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

    mapping(uint256 => bytes4) public methodSignatures;
    mapping(uint256 => address) public senders;
    mapping(uint256 => address) public targets;
    mapping(uint256 => address) public paymasters;

    // method-specific parameters tables
    mapping(uint256 => address) public recipients;

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
        uint256 batchSize = values[3].toUint();
        BLSBatchGateway.BatchItem[] memory bi = new BLSBatchGateway.BatchItem[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            bi[i] = decodeBatchItem(values, i);
        }
        return BLSBatchGateway.Batch(bi, [uint256(1), uint256(1)], 0);
    }

    function decodeBatchItem(
        RLPReader.RLPItem[] memory values,
        uint256 i//temIndex
    )
    public
    returns (
        BLSBatchGateway.BatchItem memory bi
    ) {
        // 1. read inputs
        uint256 id = values[3 + ITEM_SIZE * i + 1].toUint();
        uint256 nonce = values[3 + ITEM_SIZE * i + 2].toUint();

        uint256 paymasterId = values[3 + ITEM_SIZE * i + 3].toUint();
        uint256 senderId = values[3 + ITEM_SIZE * i + 4].toUint();
        uint256 targetId = values[3 + ITEM_SIZE * i + 5].toUint();
        RLPReader.RLPItem memory methodSignatureItem = values[3 + ITEM_SIZE * i + 6];


        // 2. resolve values
        bytes4 methodSignature;
        if (methodSignatureItem.len == 5) {
            // ?do I understand the RLP encoding correctly?
            // encoding of a full size byte array, even if it contains leading zeroes
            methodSignature = bytes4(bytes32(methodSignatureItem.toUint()));
        } else {
            uint256 methodSignatureId = methodSignatureItem.toUint();
            methodSignature = methodSignatures[methodSignatureId];
        }

        address paymaster;
        // SET MAX CACHE SIZE; VALUES BIGGER THAN THAT CONSIDERED ACTUAL INPUT
        if (paymasterId > ID_MAX_VALUE) {
            paymaster = address(uint160(paymasterId));
        } else {
            paymaster = paymasters[paymasterId];
        }
        address sender;
        if (senderId > ID_MAX_VALUE) {
            sender = address(uint160(senderId));
        } else {
            sender = senders[paymasterId];
        }
        address target;
        if (targetId > ID_MAX_VALUE) {
            target = address(uint160(targetId));
        } else {
            target = targets[paymasterId];
        }

        uint256 gasLimit;
        bytes memory methodData = values[3 + ITEM_SIZE * i + 1].toBytes();
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
        bi = BLSBatchGateway.BatchItem(id, nonce, paymaster, sender, target, methodSignature, methodData, gasLimit);
    }
}
