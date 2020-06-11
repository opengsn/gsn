// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

interface IForwarder {

    struct ForwardRequest {
        address target;
        bytes encodedFunction;
        address senderAddress;
        uint256 senderNonce;
        uint256 gasLimit;
    }

    function versionForwarder() external view returns (string memory);

    function getNonce(address from) external view returns (uint256);

    function verify(ForwardRequest calldata req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes calldata suffixData, bytes calldata sig) external view;

    function verifyAndCall(ForwardRequest calldata req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes calldata suffixData, bytes calldata sig) external;
}


/*
import "./ISignatureVerifier.sol";
pragma experimental ABIEncoderV2;

interface IForwarder {

    // verify the signature matches the request.
    //  that is, the senderAccount is the signer
    function verify(ISignatureVerifier.RelayRequest calldata req, bytes calldata sig) external view;

    // validate the signature, and execute the call.
    function verifyAndCall(ISignatureVerifier.RelayRequest calldata req, bytes calldata sig) external;

    function getNonce(address from) external view returns (uint256);

    function versionForwarder() external view returns (string memory);
}
*/
