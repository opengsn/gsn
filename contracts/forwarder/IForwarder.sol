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

    /**
     * Register a new Request typehash.
     * @param typeName - the name of the request type.
     * @param extraParams - params to add to the request type, after initial "_ForwardRequest request" param
     * @param subTypes - subtypes used by the extraParams
     * @param subTypes2 - more subtypes, if sorted after _ForwardRequest (e.g. if type starts with lowercase)
     */
    function registerRequestType(string calldata typeName, string calldata extraParams, string calldata subTypes, string calldata subTypes2) external;
}
