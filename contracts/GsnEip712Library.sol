// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./SignatureVerifier.sol";
import "./Eip712Forwarder.sol";

/**
 * Map GSN RelayRequest into a call of an Eip712Forwarder
 */
library GsnEip712Library {

    //this is the method that maps a GSN RelayRequest into generic ForwardRequest
    // TODO: move the hash function into a library. no need for instance.
    function splitRequest(SignatureVerifier sigVerifier, ISignatureVerifier.RelayRequest memory req) internal pure
      returns(Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) {

        fwd = Eip712Forwarder.ForwardRequest(
            req.target,
            req.encodedFunction,
            req.senderAddress,
            req.senderNonce,
            req.gasLimit);
        suffixData = abi.encode(
            req.forwarder,
            sigVerifier.hash(req.gasData),
            sigVerifier.hash(req.relayData));
    }

    /**
     * call forwarder.verify()
     * must first extract generic message from GSN specific structure.
     * NOTE: needs the signatureVerifier that matches this forwarder (since the forwarder is part of the
     *      domain separator)
     */
    function callForwarderVerify( ISignatureVerifier.RelayRequest memory req, SignatureVerifier sigVerifier, bytes memory sig) internal view {
        (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) = splitRequest(sigVerifier,req);
        Eip712Forwarder(req.forwarder).verify(fwd, sigVerifier.DOMAIN_SEPARATOR(), sigVerifier.RELAY_REQUEST_TYPEHASH(), suffixData, sig);
    }

    /**
     * call forwarder.verifyAndCall()
     * must first extract generic message from GSN specific structure.
     * NOTE: needs the signatureVerifier that matches this forwarder (since the forwarder is part of the
     *      domain separator)
     */
    function callForwarderVerifyAndCall(ISignatureVerifier.RelayRequest memory req, SignatureVerifier sigVerifier, bytes memory sig) internal {
        (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) = splitRequest(sigVerifier,req);
        Eip712Forwarder(req.forwarder).verifyAndCall(fwd, sigVerifier.DOMAIN_SEPARATOR(), sigVerifier.RELAY_REQUEST_TYPEHASH(), suffixData, sig);
    }
}
