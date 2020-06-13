// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

interface IForwarder {

    struct ForwardRequest {
        address to;
        bytes data;
        address from;
        uint256 nonce;
        uint256 gas;
    }

    function versionForwarder() external view returns (string memory);

    function getNonce(address from) external view returns (uint256);

    function verify(ForwardRequest calldata req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes calldata suffixData, bytes calldata sig) external view;

    function verifyAndCall(ForwardRequest calldata req,
        bytes32 domainSeparator, bytes32 requestTypeHash, bytes calldata suffixData, bytes calldata sig) external;
}
