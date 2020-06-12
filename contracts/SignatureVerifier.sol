// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./interfaces/ISignatureVerifier.sol";
import "./utils/GsnUtils.sol";

contract SignatureVerifier is ISignatureVerifier{

    using ECDSA for bytes32;

    string public versionSM = "2.0.0-alpha.1+opengsn.sv.isignatureverifier";

    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

    bytes32 public constant EIP712DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    // solhint-disable-next-line max-line-length
    bytes public constant RELAY_REQUEST_TYPE = "RelayRequest(address target,bytes encodedFunction,address senderAddress,uint256 senderNonce,uint256 gasLimit,address forwarder,GasData gasData,RelayData relayData)GasData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee)RelayData(address relayWorker,address paymaster)";
    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256(RELAY_REQUEST_TYPE);

    // solhint-disable-next-line max-line-length
    bytes32 public constant CALLDATA_TYPEHASH = keccak256("GasData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee)");

    // solhint-disable-next-line max-line-length
    bytes32 public constant RELAYDATA_TYPEHASH = keccak256("RelayData(address relayWorker,address paymaster)");

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR; //not constant - based on chainId

    constructor (address verifier) public {
        DOMAIN_SEPARATOR = hashDom(EIP712Domain({
            name : "GSN Relayed Transaction",
            version : "2",
            chainId : 1234, //GsnUtils.getChainID(),
            verifyingContract : verifier
        }));
    }

    function hashDom(EIP712Domain memory eip712Domain) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256(bytes(eip712Domain.name)),
                keccak256(bytes(eip712Domain.version)),
                eip712Domain.chainId,
                eip712Domain.verifyingContract
            ));
    }

    //obsolete..
    function hashReq(RelayRequest memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                RELAY_REQUEST_TYPEHASH,
                    req.request.to,
                    keccak256(req.request.data),
                    req.request.from,
                    req.request.nonce,
                    req.request.gas,
                    hashGas(req.gasData),
                    hashRel(req.relayData)
            ));
    }

    //TODO: "internal" method is not accessible form another contract. need to change into a "library"
    function hashGas(GasData memory req) public pure returns (bytes32) {
        return keccak256(abi.encode(
                CALLDATA_TYPEHASH,
                req.gasPrice,
                req.pctRelayFee,
                req.baseRelayFee
            ));
    }

    function hashRel(RelayData memory req) public pure returns (bytes32) {
        return keccak256(abi.encode(
                RELAYDATA_TYPEHASH,
                req.relayWorker,
                req.paymaster
            ));
    }

    function verify(RelayRequest memory req, bytes memory signature) public view returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", DOMAIN_SEPARATOR,
                hashReq(req)
            ));
        return digest.recover(signature) == req.request.from;
    }
}
