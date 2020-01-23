pragma solidity ^0.5.5;
pragma experimental ABIEncoderV2;

// https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.sol
contract EIP712Sig {
    struct EIP712Domain {
        string name;
        string version;
//        uint256 chainId;
        address verifyingContract;
    }

    struct RelayRequest {
        address target;
        uint256 gasLimit;
        uint256 gasPrice;
        bytes encodedFunction;
        address senderAccount;
        uint256 senderNonce;
        address relayAddress;
        uint256 pctRelayFee;
    }

    bytes32 constant EIP712DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,address verifyingContract)"
    );

    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256("RelayRequest(address target,uint256 gasLimit,uint256 gasPrice,bytes encodedFunction,address senderAccount,uint256 senderNonce,address relayAddress,uint256 pctRelayFee)");

    bytes32 public DOMAIN_SEPARATOR; //not constant - based on chainId

    constructor (address verifier) public {
        DOMAIN_SEPARATOR = hash(EIP712Domain({
            name : 'GSN Relayed Transaction',
            version : '1',
//            chainId : getChainID(),
            verifyingContract : verifier
            }));
    }

    function hash(EIP712Domain memory eip712Domain) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256(bytes(eip712Domain.name)),
                keccak256(bytes(eip712Domain.version)),
//                eip712Domain.chainId,
                eip712Domain.verifyingContract
            ));
    }

    function hash(RelayRequest memory req) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                RELAY_REQUEST_TYPEHASH,
                    req.target,
                    req.gasLimit,
                    req.gasPrice,
                    keccak256(req.encodedFunction),
                    req.senderAccount,
                    req.senderNonce,
                    req.relayAddress,
                    req.pctRelayFee
            ));
    }

    // from openzeppelin/ECDSA
    function verify(RelayRequest memory req, bytes memory signature) public view returns (bool) {
        // Divide the signature in r, s and v variables
        bytes32 r;
        bytes32 s;
        uint8 v;

        // ecrecover takes the signature parameters, and the only way to get them
        // currently is to use assembly.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        return verify(req, v, r, s);
    }

    function verify(RelayRequest memory req, uint8 v, bytes32 r, bytes32 s) private view returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", DOMAIN_SEPARATOR,
                hash(req)
            ));
        return ecrecover(digest, v, r, s) == req.senderAccount;
    }

    function getChainID() internal pure returns (uint256) {
//        uint256 id;
//        assembly {
//            id := chainid()
//        }
        return 7;
    }
}
