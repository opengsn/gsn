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

    struct Batch {
        BatchItem[] items;
        uint256[2] blsSignature;
        uint256 maxAcceptanceBudget;
    }

    event SkippedInvalidBatchItem(uint256 itemId, string reason);

    receive() external payable {
        revert();
    }

    fallback() external payable {
        bytes calldata rawBatch = msg.data;
        Batch memory batch = decompressor.decodeBatch(rawBatch);
        BLSTypes.BLSPublicKey[] memory blsPublicKeys;
        GsnTypes.RelayRequest[] memory relayRequests;
        uint256[2][] memory messages;
        for (uint256 i = 0; i < batch.items.length; i++) {
            relayRequests[i] = decodeBatchItem(batch.items[i]);
            blsPublicKeys[i] = authorisationsRegistrar.getAuthorisation(relayRequests[i].request.from);
            // TODO: convert relayRequests to messages
            messages[0] = [uint256(1), uint256(1)];
        }
        // TODO: is abiEncode enough? EIP-712 requires ECDSA? Can we push for amendment/alternative?
        BLS.verifyMultiple(batch.blsSignature, blsPublicKeys, messages);
//        uint256[2] memory signature,
//        uint256[4][] memory pubkeys,
//        uint256[2][] memory messages
        for (uint256 i = 0; i < relayRequests.length; i++) {
            // TODO --//--
            if (blsPublicKeys[i].pubkey[0] == 0) {
                emit SkippedInvalidBatchItem(batch.items[i].id, 'missing authorisation');
            }
            relayHub.relayCall(batch.maxAcceptanceBudget, relayRequests[i], "", "");
        }
    }

    function decodeBatchItem(BatchItem memory batchItem) public view returns (GsnTypes.RelayRequest memory relayRequest){
        relayRequest = GsnTypes.RelayRequest(
            IForwarder.ForwardRequest(address(0), address(0), 0, 0, 0, '', 0),
            GsnTypes.RelayData(0, 0, 0, 0, address(0), address(0), address(0), '', 0)
        );
    }
}
