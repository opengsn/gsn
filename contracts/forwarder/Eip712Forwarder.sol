// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./IForwarder.sol";

// a Generic EIP712 forwarder.
// actual struct has to START with known fields, but may contain other fields
contract Eip712Forwarder is IForwarder {
    using ECDSA for bytes32;

    //all valid requests must start with this prefix.
    // request name is arbitrary, but the parameter block must match exactly these parameters
    string public constant GENERIC_PARAMS = "_ForwardRequest request";
    string public constant GENERIC_TYPE = "_ForwardRequest(address to,bytes data,address from,uint256 nonce,uint256 gas)";
    bytes32 public constant GENERIC_TYPEHASH = keccak256(bytes(GENERIC_TYPE));

    mapping(bytes32 => bool) public typeHashes;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    function versionForwarder() external view virtual override returns (string memory) {
        return "2.0.0-alpha.2+opengsn.forwarder.eip712";
    }

    function getNonce(address from) external override view returns (uint256) {
        return nonces[from];
    }

    function verify(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public override view {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    function verifyAndCall(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public override {
        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        _updateNonce(req);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = req.to.call{gas: req.gas}(abi.encodePacked(req.data, req.from));
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
        require(nonces[req.from] == req.nonce, "nonce mismatch");
    }

    function _updateNonce(ForwardRequest memory req) internal {
        nonces[req.from]++;
    }

    /**
     * Register a new Request typehash.
     * @param typeName - the name of the request type.
     * @param extraParams - params to add to the request type, after initial "_ForwardRequest request" param
     * @param subTypes - subtypes used by the extraParams
     * @param subTypes2 - more subtypes, if sorted after _ForwardRequest (e.g. if type starts with lowercase)
     */
    function registerRequestType(string calldata typeName, string calldata extraParams, string calldata subTypes, string calldata subTypes2) external override {

        require(bytes(typeName).length > 0, "invalid typeName");
        bytes memory types = abi.encodePacked(subTypes, GENERIC_TYPE, subTypes2);
        string memory comma = bytes(extraParams).length > 0 ? "," : "";

        bytes memory requestType = abi.encodePacked(
            typeName, "(",
            GENERIC_PARAMS, comma, extraParams, ")",
            types
        );
        bytes32 requestTypehash = keccak256(bytes(requestType));
        uint len = bytes(subTypes).length;
        //sanity: avoid redefining our type, e.g.: subType="_ForwardRequest(whatever)_z"
        require(len == 0 || bytes(subTypes)[len - 1] == ")", "invalid subType");
        //sanity: parameters should not end parameters block
        for (uint i = 0; i < bytes(extraParams).length; i++) {
            require(bytes(extraParams)[i] != ")", "invalid extraParams");
        }
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, string(requestType));
    }

    function isRegisteredTypehash(bytes32 typehash) public view returns (bool) {
        return typeHashes[typehash];
    }

    event RequestTypeRegistered(bytes32 indexed typeHash, string typeStr);

    function _verifySig(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) internal view {

        require(typeHashes[requestTypeHash], "invalid request typehash");
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", domainSeparator,
                keccak256(_getEncoded(req, requestTypeHash, suffixData))
            ));
        require(digest.recover(sig) == req.from, "signature mismatch");
    }

    function _getEncoded(ForwardRequest memory req,
        bytes32 requestTypeHash, bytes memory suffixData) public pure returns (bytes memory) {
        return abi.encodePacked(
            requestTypeHash,
            hash(req),
            suffixData
        );
    }

    function hash(ForwardRequest memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                GENERIC_TYPEHASH,
                req.to,
                keccak256(req.data),
                req.from,
                req.nonce,
                req.gas));
    }
}
