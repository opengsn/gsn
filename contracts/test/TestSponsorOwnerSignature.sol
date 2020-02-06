pragma solidity ^0.5.16;

import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

import "./TestSponsorEverythingAccepted.sol";

contract TestSponsorOwnerSignature is TestSponsorEverythingAccepted {
    using ECDSA for bytes32;

    /**
     * This demonstrates how dapps can provide an off-chain signatures to relayed transactions.
     */
    function acceptRelayedCall(
        address relay,
        address from,
        bytes calldata encodedFunction,
        uint256 transactionFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    view
    returns (uint256, bytes memory){
        if (keccak256(abi.encodePacked("I approve", from)).toEthSignedMessageHash().recover(approvalData) != owner()) {
            return (13, "test: not approved");
        }
        return (0, "");
    }
}
