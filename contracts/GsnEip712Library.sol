// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./interfaces/ISignatureVerifier.sol";
import "./interfaces/IRelayRecipient.sol";
import "./Eip712Forwarder.sol";

/**
 * Bridge Library to map GSN RelayRequest into a call of an Eip712Forwarder
 */
library GsnEip712Library {

    //copied from Eip712Forwarder (can't reference string constants even from another library)
    string public constant GENERIC_PARAMS = "_ForwardRequest request";
    string public constant GENERIC_TYPE = "_ForwardRequest(address target,bytes encodedFunction,address senderAddress,uint256 senderNonce,uint256 gasLimit)";
    bytes32 public constant GENERIC_TYPEHASH = keccak256(bytes(GENERIC_TYPE));

    bytes public constant CALLDATA_TYPE = "GasData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee)";

    bytes public constant RELAYDATA_TYPE = "RelayData(address relayWorker,address paymaster)";

    string public constant RELAY_REQUEST_NAME = "RelayRequest";
    string public constant RELAY_REQUEST_PARAMS = "GasData gasData,RelayData relayData";

    bytes public constant RELAY_REQUEST_TYPE = abi.encodePacked(
        RELAY_REQUEST_NAME,"(",GENERIC_PARAMS,",", RELAY_REQUEST_PARAMS,")",
        CALLDATA_TYPE, RELAYDATA_TYPE, GENERIC_TYPE);

    bytes32 public constant CALLDATA_TYPEHASH = keccak256(CALLDATA_TYPE);
    bytes32 public constant RELAYDATA_TYPEHASH = keccak256(RELAYDATA_TYPE);
    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256(RELAY_REQUEST_TYPE);

    //must call this method exactly once to register the GSN type.
    // (note that its a public method: anyone can register this GSN version)
    function registerRequestType(Eip712Forwarder forwarder) internal {
        forwarder.registerRequestType(
            RELAY_REQUEST_NAME, RELAY_REQUEST_PARAMS, string(abi.encodePacked(CALLDATA_TYPE, RELAYDATA_TYPE)), "" );
        require(forwarder.isRegisteredTypehash(RELAY_REQUEST_TYPEHASH), "Fatal: registration failed");
    }

    //this is the method that maps a GSN RelayRequest into generic ForwardRequest
    // TODO: move the hash function into a library. no need for instance.
    function splitRequest(ISignatureVerifier.RelayRequest memory req) internal pure
    returns (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) {

        //should be a struct copy - but ABIv2 struct requires manual field-by-field copy..
        fwd = //req.request;
            IForwarder.ForwardRequest(
            req.request.target,
            req.request.encodedFunction,
            req.request.senderAddress,
            req.request.senderNonce,
            req.request.gasLimit);
        suffixData = abi.encode(
            hashGasData(req.gasData),
            hashRelayData(req.relayData));
    }

    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

    bytes32 public constant EIP712DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    /**
     * call forwarder.verify()
     */
    function callForwarderVerify(ISignatureVerifier.RelayRequest memory req, bytes memory sig) internal view {
        require( IRelayRecipient(req.request.target).isTrustedForwarder(req.extraData.forwarder), "invalid forwarder for recipient");
        (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) = splitRequest(req);
        Eip712Forwarder forwarder = Eip712Forwarder(req.extraData.forwarder);
        forwarder.verify(fwd, req.extraData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, sig);
    }

    /**
     * call forwarder.verifyAndCall()
     * note that we call it with address.call, and return (success,ret): this helper is a library
     * function, and library function can't be wrapped with try/catch... (or called with address.call)
     */
    function callForwarderVerifyAndCall(ISignatureVerifier.RelayRequest memory req, bytes memory sig) internal returns (bool success, bytes memory ret) {
        (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) = splitRequest(req);
        // Eip712Forwarder forwarder = Eip712Forwarder(req.extraData.forwarder);
        // forwarder.verifyAndCall(fwd, req.extraData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, sig);
        /* solhint-disable avoid-low-level-calls */
        return req.extraData.forwarder.call(abi.encodeWithSelector(IForwarder.verifyAndCall.selector,
            fwd, req.extraData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, sig
        ));
    }

    function domainSeparator(address forwarder) internal pure returns (bytes32) {
        return hashDomain(EIP712Domain({
            name : "GSN Relayed Transaction",
            version : "2",
            chainId : 1234, // getChainID(),
            verifyingContract : forwarder
            }));
    }

    function getChainID() internal pure returns (uint256) {
        uint256 id;
        /* solhint-disable no-inline-assembly */
        assembly {
            id := chainid()
        }
        return id;
    }

    function hashDomain(EIP712Domain memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256(bytes(req.name)),
                keccak256(bytes(req.version)),
                req.chainId,
                req.verifyingContract));
    }

    function hashGasData(ISignatureVerifier.GasData memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                CALLDATA_TYPEHASH,
                req.gasPrice,
                req.pctRelayFee,
                req.baseRelayFee
            ));
    }

    function hashRelayData(ISignatureVerifier.RelayData memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                RELAYDATA_TYPEHASH,
                req.relayWorker,
                req.paymaster
            ));
    }


}
