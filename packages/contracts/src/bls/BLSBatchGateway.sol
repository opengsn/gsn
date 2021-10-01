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
            blsPublicKeys[i] = [
            0x2591180d099ddbc1b4cfcfaf2450dc0f054339950d461a88bdfe27d513268f3a,
            0x0b5f4bda51133493803cd01f82b77ec9e20485f233136f0189f4873615b03c36,
            0x103cb7ac4b0d13f4bab829a88f1303741673663077568953b30721054d822e27,
            0x08cf151d45f98f4003bcad178e7188bdb62cca4858e8dd3dab63542b83240229
            ];
            //;authorisationsRegistrar.getAuthorisation(relayRequests[i].request.from);
            // TODO: convert relayRequests to messages
            messages[i] = [
            0x0144452bb020b7f5ae1fd4fcbd5375c69c0966482abc7ca8768973f18019ee34,
            0x041b981eedc6773924050521a9e7706440b9b8b477f7ca4b6580230801d678bc
            ];
        }
        uint256[2] memory validSig = [
        0x2169f1cf7b279b5cd8b25d42bf432296c302f066e5258fe9785c888689fe94b9,
        0x196e1dda38e0289a0d9628b7fca627e1bebc2c5985e64be3dd75529895916aef
        ];
        // TODO: is abiEncode enough? EIP-712 requires ECDSA? Can we push for amendment/alternative?
        bool isSignatureValid = BLS.verifyMultiple(validSig /*batch.blsSignature*/, blsPublicKeys, messages);
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
                rejected++;
            }
        }
        emit BatchRelayed(msg.sender, accepted, rejected);
    }

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
