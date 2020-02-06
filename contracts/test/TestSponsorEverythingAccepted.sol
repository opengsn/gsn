pragma solidity ^0.5.16;

import "../BaseGasSponsor.sol";

contract TestSponsorEverythingAccepted is BaseGasSponsor {

    event SampleRecipientPreCall();
    event SampleRecipientPostCall(bool success, uint actualCharge, bytes32 preRetVal);

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
        return (0, "");
    }

    function preRelayedCall(bytes calldata context)
    relayHubOnly
    external
    returns (bytes32){
        emit SampleRecipientPreCall();
        return bytes32(uint(123456));
    }

    function postRelayedCall(
        bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal
    )
    relayHubOnly
    external
    {
        emit SampleRecipientPostCall(success, actualCharge, preRetVal);
    }

    function setHub(IRelayHub _relayHub) public {
        relayHub = _relayHub;
    }

    function deposit() public payable {
        require(address(relayHub) != address(0), 'relay hub address not set');
        relayHub.depositFor.value(msg.value)(address(this));
    }
}
