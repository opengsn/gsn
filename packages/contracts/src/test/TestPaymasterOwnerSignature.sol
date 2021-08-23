// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterOwnerSignature is TestPaymasterEverythingAccepted {
    using ECDSA for bytes32;

    /**
     * This demonstrates how dapps can provide an off-chain signatures to relayed transactions.
     */
    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    view
    override
    returns (bytes memory, bool) {
        (signature, maxPossibleGas);
        _verifyForwarder(relayRequest);

        address signer =
            keccak256(abi.encodePacked("I approve", relayRequest.request.from))
            .toEthSignedMessageHash()
            .recover(approvalData);
        require(signer == owner(), "test: not approved");
        return ("",false);
    }
}
