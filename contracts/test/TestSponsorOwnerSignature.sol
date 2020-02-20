pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

import "./TestSponsorEverythingAccepted.sol";

contract TestSponsorOwnerSignature is TestSponsorEverythingAccepted {
    using ECDSA for bytes32;

    /**
     * This demonstrates how dapps can provide an off-chain signatures to relayed transactions.
     */
    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    view
    returns (uint256, bytes memory) {
        (maxPossibleCharge);
        address signer =
            keccak256(abi.encodePacked("I approve", relayRequest.relayData.senderAccount))
            .toEthSignedMessageHash()
            .recover(approvalData);
        if (signer != owner()) {
            return (13, "test: not approved");
        }
        return (0, "");
    }
}
