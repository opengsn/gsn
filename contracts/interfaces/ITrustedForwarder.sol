// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../utils/GSNTypes.sol";

interface ITrustedForwarder {

    // verify the signature matches the request.
    //  that is, the senderAccount is the signer
    function verify(GSNTypes.RelayRequest calldata req, bytes calldata sig) external view;

    // validate the signature, and execute the call.
    function verifyAndCall(GSNTypes.RelayRequest calldata req, bytes calldata sig) external;

    function getNonce(address from) external view returns (uint256);

    function versionForwarder() external view returns (string memory);
}
