// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/IRelayHub.sol";
import "../forwarder/IForwarder.sol";

import "../utils/RLPReader.sol";
import "../utils/GsnTypes.sol";

import "./BLS.sol";
import "./BLSTypes.sol";
import "./BLSAddressAuthorisationsRegistrar.sol";
import "./DomainSpecificInputDecompressor.sol";


contract BLSBatchGateway {

    // TODO: consider allowing RelayServers to specify decompressor address as port of the input
    DomainSpecificInputDecompressor public decompressor;
    BLSAddressAuthorisationsRegistrar public authorisationsRegistrar;
    IRelayHub public relayHub;


    // subset of fields for RelayRequest + id;
    struct BatchItem {
        uint256 id; // input
        uint256 nonce; // input
        address paymaster; // cached
        address sender; // cached
        address target; // cached
        bytes4 methodSignature; // cached
        bytes methodData; // only ABI encoding, shortened input
        uint256 gasLimit; // not input usually
    }

    struct ApprovalItem {
        address from;
        uint256[4] blsPublicKey;
        bytes signature;
    }

    struct Batch {
        BatchItem[] items;
        ApprovalItem[] approvalItems;
        uint256[2] blsSignature;
        uint256 maxAcceptanceBudget;
    }

    event BatchRelayed(address indexed relayWorker, uint256 accepted, uint256 rejected);
    event SkippedInvalidBatchItem(uint256 itemId, string reason);

    constructor(
        DomainSpecificInputDecompressor _decompressor,
        BLSAddressAuthorisationsRegistrar _authorisationsRegistrar,
        IRelayHub _relayHub
    ) {
        decompressor = _decompressor;
        authorisationsRegistrar = _authorisationsRegistrar;
        relayHub = _relayHub;
    }

    receive() external payable {
        revert();
    }

    fallback() external payable {
        Batch memory batch = decompressor.decodeBatch(msg.data);
        handleNewApprovals(batch.approvalItems);

        if (batch.items.length == 0) {
            // TODO: I am considering 'rawBatch' with an extra field for caching, thus having to relay empty batch
            // also useful as an 'activity indicator'
            emit BatchRelayed(msg.sender, 0, 0);
            return;
        }
        uint256[4][] memory blsPublicKeys = new uint256[4][](batch.items.length);
        GsnTypes.RelayRequest[] memory relayRequests = new GsnTypes.RelayRequest[](batch.items.length);
        uint256[2][] memory messages = new uint256[2][](batch.items.length);
        for (uint256 i = 0; i < batch.items.length; i++) {
            relayRequests[i] = decodeBatchItem(batch.items[i]);
            blsPublicKeys[i] = authorisationsRegistrar.getAuthorisedPublicKey(relayRequests[i].request.from);
            // TODO: require key is not null
//            messages[i] = BLS.hashToPoint('testing-evmbls', abi.encode(relayRequests[i]));
            messages[i] = BLS.hashToPoint('testing-evmbls', abi.encodePacked(bytes4(0xffffffff)));
        }
        // TODO: is abiEncode enough? EIP-712 requires ECDSA? Can we push for amendment/alternative?
        bool isSignatureValid = BLS.verifyMultiple(batch.blsSignature, blsPublicKeys, messages);
        require(isSignatureValid, "BLS signature verification failed");

        //        uint256[2] memory signature,
        //        uint256[4][] memory pubkeys,
        //        uint256[2][] memory messages
        uint256 accepted = 0;
        uint256 rejected = 0;
        for (uint256 i = 0; i < relayRequests.length; i++) {
            // TODO --//--
            //            if (blsPublicKeys[i].pubkey[0] == 0) {
            //                emit SkippedInvalidBatchItem(batch.items[i].id, 'missing authorisation');
            //            }
            (bool success, bytes memory returnData) = address(relayHub).call(abi.encodeWithSelector(relayHub.relayCall.selector, batch.items[i].id, batch.maxAcceptanceBudget, relayRequests[i], "", ""));
            // TODO: this count gathering is ugly, think if we actually need it?
            if (success) {
                (bool paymasterAccepted,) = abi.decode(returnData, (bool, bytes));
                if (paymasterAccepted) {
                    accepted++;
                } else {
                    rejected++;
                }
            } else {
                emit RelayCallReverted(batch.items[i].id, returnData);
                rejected++;
            }
        }
        emit BatchRelayed(msg.sender, accepted, rejected);
    }

    event RelayCallReverted(uint256 indexed batchItemId, bytes returnData);

    function decodeBatchItem(BatchItem memory batchItem) public view returns (GsnTypes.RelayRequest memory){
        return GsnTypes.RelayRequest(
            IForwarder.ForwardRequest(batchItem.sender, batchItem.target, 0, 0, 0, '', 0),
            GsnTypes.RelayData(0, 0, 0, 0, address(0), address(0), address(0), '', 0)
        );
    }

    function handleNewApprovals(ApprovalItem[] memory approvalItems) internal {
        for (uint256 i; i < approvalItems.length; i++) {
            authorisationsRegistrar.registerAddressAuthorisation(
                approvalItems[i].from,
                approvalItems[i].blsPublicKey,
                approvalItems[i].signature
            );
        }
    }
}
