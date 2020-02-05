pragma solidity ^0.5.16;

import "./TestSponsorEverythingAccepted.sol";

contract TestSponsorPreconfiguredApproval is TestSponsorEverythingAccepted {

    bytes public expectedApprovalData;

    function setExpectedApprovalData(bytes memory val) public {
        expectedApprovalData = val;
    }

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
        if (keccak256(expectedApprovalData) != keccak256(approvalData)) {
            return (14, abi.encodePacked("test: unexpected approvalData: '", approvalData, "' instead of '", expectedApprovalData, "'"));
        }
        return (0, "");
    }
}
