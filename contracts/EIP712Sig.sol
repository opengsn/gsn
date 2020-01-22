pragma solidity ^0.5.5;
pragma experimental ABIEncoderV2;

// https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.sol
contract EIP712Sig {

    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
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
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public constant RELAY_REQUEST_TYPEHASH = keccak256("RelayRequest(address target,uint256 gasLimit,uint256 gasPrice,bytes encodedFunction,address senderAccount,uint256 senderNonce,address relayAddress,uint256 pctRelayFee)");

    bytes32 public DOMAIN_SEPARATOR; //not constant - based on chainId

    constructor (address verifier, uint256 chainId) public {
        DOMAIN_SEPARATOR = hash(EIP712Domain({
            name : 'GSN Relayed Transaction',
            version : '1',
            chainId : chainId,
            verifyingContract : verifier
            }));
    }

    function hash(EIP712Domain memory eip712Domain) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256(bytes(eip712Domain.name)),
                keccak256(bytes(eip712Domain.version)),
                eip712Domain.chainId,
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

    function verify(RelayRequest memory req, uint8 v, bytes32 r, bytes32 s) public view returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", DOMAIN_SEPARATOR,
                hash(req)
            ));
        return ecrecover(digest, v, r, s) == req.senderAccount;
    }
}
