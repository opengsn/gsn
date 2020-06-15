// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../interfaces/GsnTypes.sol";
import "../interfaces/IRelayRecipient.sol";
import "../forwarder/Eip712Forwarder.sol";

/**
 * Bridge Library to map GSN RelayRequest into a call of an Eip712Forwarder
 */
library GsnEip712Library {

    //copied from Eip712Forwarder (can't reference string constants even from another library)
    string public constant GENERIC_PARAMS = "_ForwardRequest request";
    string public constant GENERIC_TYPE = "_ForwardRequest(address to,bytes data,address from,uint256 nonce,uint256 gas)";
    bytes32 public constant GENERIC_TYPEHASH = keccak256(bytes(GENERIC_TYPE));

    bytes public constant RELAYDATA_TYPE = "RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster)";

    string public constant RELAY_REQUEST_NAME = "RelayRequest";
    string public constant RELAY_REQUEST_PARAMS = "RelayData relayData";

    bytes public constant RELAY_REQUEST_TYPE = abi.encodePacked(
        RELAY_REQUEST_NAME,"(",GENERIC_PARAMS,",", RELAY_REQUEST_PARAMS,")",
        RELAYDATA_TYPE, GENERIC_TYPE);

    bytes32 public constant RELAYDATA_TYPEHASH = keccak256(RELAYDATA_TYPE);
    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256(RELAY_REQUEST_TYPE);

    //must call this method exactly once to register the GSN type.
    // (note that its a public method: anyone can register this GSN version)
    function registerRequestType(Eip712Forwarder forwarder) internal {
        forwarder.registerRequestType(
            RELAY_REQUEST_NAME, RELAY_REQUEST_PARAMS, string(RELAYDATA_TYPE), "" );
        require(forwarder.isRegisteredTypehash(RELAY_REQUEST_TYPEHASH), "Fatal: registration failed");
    }

    //this is the method that maps a GSN RelayRequest into generic ForwardRequest
    // TODO: move the hash function into a library. no need for instance.
    function splitRequest(GsnTypes.RelayRequest memory req) internal pure
    returns (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) {

        fwd = req.request;
        suffixData = abi.encode(
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
    function callForwarderVerify(GsnTypes.RelayRequest memory req, bytes memory sig) internal view {
        require( IRelayRecipient(req.request.to).isTrustedForwarder(req.extraData.forwarder), "invalid forwarder for recipient");
        (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) = splitRequest(req);
        Eip712Forwarder forwarder = Eip712Forwarder(req.extraData.forwarder);
        forwarder.verify(fwd, req.extraData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, sig);
    }

    /**
     * call forwarder.verifyAndCall()
     * note that we call it with address.call, and return (success,ret): this helper is a library
     * function, and library function can't be wrapped with try/catch... (or called with address.call)
     */
    function callForwarderVerifyAndCall(GsnTypes.RelayRequest memory req, bytes memory sig) internal returns (bool success, bytes memory ret) {
        try IRelayRecipient(req.request.to).isTrustedForwarder(req.extraData.forwarder) returns (bool isTrusted) {
            require( isTrusted, "invalid forwarder for recipient");
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert("reverted: isTrustedForwarder");
        }
        (Eip712Forwarder.ForwardRequest memory fwd, bytes memory suffixData) = splitRequest(req);
        /* solhint-disable-next-line avoid-low-level-calls */
        try IForwarder(req.extraData.forwarder).verifyAndCall(
            fwd, req.extraData.domainSeparator, RELAY_REQUEST_TYPEHASH, suffixData, sig)
            returns (bool _success, bytes memory _ret) {
            return (_success, _ret);
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert("reverted: verifyAndCall");
        }
    }

    function domainSeparator(address forwarder) internal pure returns (bytes32) {
        return hashDomain(EIP712Domain({
            name : "GSN Relayed Transaction",
            version : "2",
            chainId : getChainID(),
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

    function hashRelayData(GsnTypes.RelayData memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                RELAYDATA_TYPEHASH,
                req.gasPrice,
                req.pctRelayFee,
                req.baseRelayFee,
                req.relayWorker,
                req.paymaster
            ));
    }


}
