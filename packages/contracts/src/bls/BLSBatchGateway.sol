// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/IRelayHub.sol";
import "../forwarder/IForwarder.sol";

import "../utils/RLPReader.sol";
import "../utils/GsnTypes.sol";

import "./BLS.sol";
import "./BLSAddressAuthorizationsRegistrar.sol";
import "./DomainSpecificInputDecompressor.sol";
import "./interfaces/BLSTypes.sol";

contract BLSBatchGateway {

    DomainSpecificInputDecompressor public decompressor;
    BLSAddressAuthorizationsRegistrar public authorizationsRegistrar;
    IRelayHub public relayHub;

    event RelayCallReverted(uint256 indexed batchItemId, bytes returnData);
    event BatchRelayed(address indexed relayWorker, uint256 batchSize);
    event SkippedInvalidBatchItem(uint256 itemId, string reason);

    constructor(
        DomainSpecificInputDecompressor _decompressor,
        BLSAddressAuthorizationsRegistrar _authorizationsRegistrar,
        IRelayHub _relayHub
    ) {
        decompressor = _decompressor;
        authorizationsRegistrar = _authorizationsRegistrar;
        relayHub = _relayHub;
    }

    receive() external payable {
        revert();
    }

    fallback() external payable {
        BLSTypes.Batch memory batch = decompressor.decodeBatch(msg.data);
        handleNewApprovals(batch.authorizations);

        if (batch.relayRequests.length == 0) {
            emit BatchRelayed(msg.sender, 0);
            return;
        }
        uint256[4][] memory blsPublicKeys = new uint256[4][](batch.relayRequests.length);
        uint256[2][] memory messages = new uint256[2][](batch.relayRequests.length);
        for (uint256 i = 0; i < batch.relayRequests.length; i++) {
            blsPublicKeys[i] = authorizationsRegistrar.getAuthorizedPublicKey(batch.relayRequests[i].request.from);
            // TODO: require key is not null
//            messages[i] = BLS.hashToPoint('testing-evmbls', abi.encode(relayRequests[i]));
            messages[i] = BLS.hashToPoint('testing-evmbls', abi.encodePacked(bytes4(0xffffffff)));
        }
        // TODO: is abiEncode enough? EIP-712 requires ECDSA? Can we push for amendment/alternative?
        bool isSignatureValid = BLS.verifyMultiple(batch.blsSignature, blsPublicKeys, messages);
        require(isSignatureValid, "BLS signature verification failed");

        for (uint256 i = 0; i < batch.relayRequests.length; i++) {
            (bool success, bytes memory returnData) = address(relayHub).call(abi.encodeWithSelector(relayHub.relayCall.selector, batch.relayRequestIds[i], batch.metadata.maxAcceptanceBudget, batch.relayRequests[i], "", ""));
            if (success) {
                (bool paymasterAccepted,) = abi.decode(returnData, (bool, bytes));
            } else {
                emit RelayCallReverted(batch.relayRequestIds[i], returnData);
            }
        }
        emit BatchRelayed(msg.sender, batch.relayRequests.length);
    }

    function handleNewApprovals(BLSTypes.SignedKeyAuthorization[] memory approvalItems) internal {
        for (uint256 i; i < approvalItems.length; i++) {
            authorizationsRegistrar.registerAddressAuthorization(
                approvalItems[i].from,
                approvalItems[i].blsPublicKey,
                approvalItems[i].signature
            );
        }
    }
}
