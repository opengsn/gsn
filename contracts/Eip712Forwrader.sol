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
    // (note that the prefix is not a valid type by itself: it doesn't end with ")" (or ",", if more fields are added)
    string constant typehashPrefix = "Forward(address sender, address target, bytes encodedFunction, uint256 gasLimit, address forwarder";

    mapping(bytes32 => bool) public typeHashes;

    struct Forward {
        address sender;
        address target;
        bytes encodedFunction;
        uint256 gasLimit;
        uint256 nonce;
        address forwarder;
    }

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    function getNonce(address from) external view returns (uint256) {
        return nonces[from];
    }

    function verify(Forward memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public view {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    function verifyAndCall(Forward memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public {
        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        _updateNonce(req);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = req.target.call{gas : req.gasLimit}(abi.encodePacked(req.encodedFunction, req.sender));
        if (!success) {
            assembly { // This assembly ensure the revert contains the exact string data
                let returnDataSize := returndatasize()
                returndatacopy(0, 0, returnDataSize)
                revert(0, returnDataSize)
            }
        }
    }


    function _verifyNonce(Forward memory req) internal view {
        require(nonces[req.sender] == req.nonce, "nonce mismatch");
    }

    function _updateNonce(Forward memory req) internal {
        nonces[req.sender]++;
    }

    //register a requestTypeHash
    // the given requestType must have typehashPrefix as the beginning of the type string,
    // otherwise it can't be registered.

    function registerRequestTypeHash(string calldata requestType) external {
        bytes32 requestTypehash = keccak256(bytes(requestType));
        require(!typeHashes[requestTypehash], "typehash already registered");
        require(bytes(requestType).length >= bytes(typehashPrefix).length, "invalid typehash prefix");
        for (uint i = 0; i < bytes(typehashPrefix).length; i++) {
            require(bytes(requestType)[i] == bytes(typehashPrefix)[i], "invalid typehash");
        }
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, requestType);
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
    function _verifySig(Forward memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) internal view {

        require(typeHashes[requestTypeHash], "invalid request typehash");
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x10", domainSeparator,
                keccak256(abi.encodePacked(
                    requestTypeHash,
                    req.sender,
                    req.target,
                    keccak256(req.encodedFunction),
                    req.gasLimit,
                    req.nonce,
                    req.forwarder,
                    suffixData
                ))
            ));
        require(digest.recover(sig) == req.sender, "signature mismatch");
    }
}
