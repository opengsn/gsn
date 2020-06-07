// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./utils/GsnUtils.sol";

// a Generic EIP712 forwarder.
// actual struct has to START with known fields, but may contain other fields
contract Eip712Forwarder {
    using ECDSA for bytes32;

    //all valid requests must start with this prefix.
    // request name is arbitrary, but the parameter block must match exactly these parameters
    string public constant GENERIC_PARAMS="_ForwardRequest request";
    string public constant GENERIC_TYPE="_ForwardRequest(address target,bytes encodedFunction,address senderAddress,uint256 senderNonce,uint256 gasLimit)";

    mapping(bytes32 => bool) public typeHashes;

    struct ForwardRequest {
        address target;
        bytes encodedFunction;
        address senderAddress;
        uint256 senderNonce;
        uint256 gasLimit;
    }

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    function getNonce(address from) external view returns (uint256) {
        return nonces[from];
    }

    function verify(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public view {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    function verifyAndCall(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public {
        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        _updateNonce(req);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = req.target.call{gas : req.gasLimit}(abi.encodePacked(req.encodedFunction, req.senderAddress));
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {// This assembly ensure the revert contains the exact string data
                let returnDataSize := returndatasize()
                returndatacopy(0, 0, returnDataSize)
                revert(0, returnDataSize)
            }
        }
    }


    function _verifyNonce(ForwardRequest memory req) internal view {
        require(nonces[req.senderAddress] == req.senderNonce, "nonce mismatch");
    }

    function _updateNonce(ForwardRequest memory req) internal {
        nonces[req.senderAddress]++;
    }

    //register a requestTypeHash
    // the given requestType must have GENERIC_PARAMS as the beginning of the type string,
    // otherwise it can't be registered.

    /**
     * Register a new Request typehash.
     * @param typeName - the name of the request type.
     * @param extraParams - params to add to the request type, after initial "_ForwardRequest request" param
     * @param subTypes - subtypes used by the extraParams
     * @param subTypes2 - more subtypes, if sorted after _ForwardRequest (e.g. if type starts with lowercase)
     */
    function registerRequestType(string calldata typeName,string calldata extraParams, string calldata subTypes, string calldata subTypes2) external {
        string memory comma = bytes(extraParams).length > 0 ? "," : "";

        bytes memory requestType = abi.encodePacked(
            typeName, "(",
            GENERIC_PARAMS, comma, extraParams, ")",
            subTypes, GENERIC_TYPE, subTypes2
        );
        bytes32 requestTypehash = keccak256(bytes(requestType));
        uint len = bytes(subTypes).length;
        //sanity: avoid redefining our type, e.g.: subType="_ForwardRequest(whatever)_z"
        require( len==0 || bytes(subTypes)[len-1]==")", "invalid subType");
        require(!typeHashes[requestTypehash], "typehash already registered");
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, string(requestType));
    }

    function isRegisteredTypehash(bytes32 typehash) public view returns (bool) {
        return typeHashes[typehash];
    }

    event RequestTypeRegistered(bytes32 indexed typehash, string typeStr);


    //EIP712 sig:
    //    keccak(
    //        "\0x19\x01" , domainSeparator,
    //        keccak(
    //            request_typehash,
    //            known-fields,
    //            suffix-data
    //        )
    //    )
    function _verifySig(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) internal view {

        require(typeHashes[requestTypeHash], "invalid request typehash");
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", domainSeparator,
                keccak256(abi.encodePacked(abi.encode(
                    requestTypeHash,
                    req.target,
                    keccak256(req.encodedFunction),
                    req.senderAddress,
                    req.senderNonce,
                    req.gasLimit),
                suffixData
                ))
            ));
        require(digest.recover(sig) == req.senderAddress, "signature mismatch");
    }
}
