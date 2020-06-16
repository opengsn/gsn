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
    string public constant GENERIC_PARAMS = "address to,bytes data,address from,uint256 nonce,uint256 gas";

    mapping(bytes32 => bool) public typeHashes;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) public nonces;

    function versionForwarder() external view virtual override returns (string memory) {
        return "2.0.0-alpha.2+opengsn.forwarder.eip712";
    }

    function verify(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig) public override view {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    //note that verifyAndCall doesn't re-throw target's call revert, but instead return it as (success,ret).
    // the nonce is incremented either if the target method reverts or not.
    function verifyAndCall(ForwardRequest memory req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes memory suffixData, bytes memory sig)
    public override
    returns (bool success, bytes memory ret) {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        _updateNonce(req);

        // solhint-disable-next-line avoid-low-level-calls
        return req.to.call{gas: req.gas}(abi.encodePacked(req.data, req.from));
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
    function registerRequestType(string calldata typeName, string calldata typeSuffix) external override {

        bytes memory requestType = abi.encodePacked(typeName, "(", GENERIC_PARAMS, typeSuffix);
        bytes32 requestTypehash = keccak256(bytes(requestType));
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, string(requestType));
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
        return abi.encodePacked(requestTypeHash,
                req.to,
                keccak256(req.data),
                req.from,
                req.nonce,
                req.gas,
                suffixData);
    }
}
