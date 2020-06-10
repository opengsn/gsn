// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../interfaces/ISignatureVerifier.sol";
import "../GsnEip712Library.sol";
import "../utils/GsnUtils.sol";

contract TestUtil {


    //helpers for test to call the library funcs:
    function callForwarderVerify(ISignatureVerifier.RelayRequest memory relayRequest,
        bytes memory signature) public view {
        (this);

        GsnEip712Library.callForwarderVerify(relayRequest,signature);
    }

    function callForwarderVerifyAndCall(ISignatureVerifier.RelayRequest memory relayRequest,
        bytes memory signature) public returns (bool success, bytes memory ret) {

        (success, ret) = GsnEip712Library.callForwarderVerifyAndCall(relayRequest,signature);
        emit Called(success,ret, success==false ? GsnUtils.getError(ret):"");
    }

    event Called(bool success, bytes ret, string error);

    function splitRequest(ISignatureVerifier.RelayRequest memory req) public pure
    returns (Eip712Forwarder.ForwardRequest memory fwd, bytes32 domainSeparator, bytes32 typeHash, bytes memory suffixData) {
        (fwd, suffixData) = GsnEip712Library.splitRequest(req);
        typeHash = GsnEip712Library.RELAY_REQUEST_TYPEHASH;
        domainSeparator = req.extraData.domainSeparator;
    }
}
