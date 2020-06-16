// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./IForwarder.sol";
// TODO now: move getError to the forwarder folder
import "../utils/GsnUtils.sol";

contract Eip712Forwarder is IForwarder {
    using ECDSA for bytes32;

    string public constant GENERIC_PARAMS = "address to,bytes data,address from,uint256 nonce,uint256 gas";

    mapping(bytes32 => bool) public typeHashes;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    function getNonce(address from)
    public view override
    returns (uint256) {
        return nonces[from];
    }

    function verify(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes memory suffixData,
        bytes memory sig)
    public override view {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
    }

    function execute(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes memory suffixData,
        bytes memory sig
    )
    public
    override
    returns (bool, bytes memory) {

        _verifyNonce(req);
        _verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        _updateNonce(req);

        // solhint-disable-next-line avoid-low-level-calls
        return req.to.call{gas : req.gas}(abi.encodePacked(req.data, req.from));
    }

    function _verifyNonce(ForwardRequest memory req) internal view {
        require(nonces[req.from] == req.nonce, "nonce mismatch");
    }

    function _updateNonce(ForwardRequest memory req) internal {
        nonces[req.from]++;
    }

    function registerRequestType(string calldata typeName, string calldata typeSuffix) external override {

        for (uint i = 0; i < bytes(typeName).length; i++) {
            bytes1 c = bytes(typeName)[i];
            require(c != '(' && c != ')', "invalid typename");
        }

        bytes1 separator = ")";
        if (bytes(typeSuffix).length > 0) separator = ",";

        bytes memory requestType = abi.encodePacked(typeName, "(", GENERIC_PARAMS, separator, typeSuffix);
        bytes32 requestTypehash = keccak256(bytes(requestType));
        typeHashes[requestTypehash] = true;
        emit RequestTypeRegistered(requestTypehash, string(requestType));
    }

    event RequestTypeRegistered(bytes32 indexed typeHash, string typeStr);

    function _verifySig(
        ForwardRequest memory req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes memory suffixData,
        bytes memory sig)
    internal
    view
    {

        require(typeHashes[requestTypeHash], "invalid request typehash");
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", domainSeparator,
                keccak256(_getEncoded(req, requestTypeHash, suffixData))
            ));
        require(digest.recover(sig) == req.from, "signature mismatch");
    }

    function _getEncoded(
        ForwardRequest memory req,
        bytes32 requestTypeHash,
        bytes memory suffixData
    )
    public
    pure
    returns (
        bytes memory
    ) {
        return abi.encodePacked(
            requestTypeHash,
            abi.encode(
                req.to,
                keccak256(req.data),
                req.from,
                req.nonce,
                req.gas
            ),
            suffixData
        );
    }
}
