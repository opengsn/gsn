pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../BasePaymaster.sol";

contract TestPaymasterEverythingAccepted is BasePaymaster {

    event SampleRecipientPreCall();
    event SampleRecipientPostCall(bool success, uint actualCharge, bytes32 preRetVal);

    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    view
    returns (bytes memory) {
        (relayRequest, approvalData, maxPossibleCharge);
        return "";
    }

    function preRelayedCall(
        bytes calldata context
    )
    external
    relayHubOnly
    returns (bytes32) {
        (context);
        emit SampleRecipientPreCall();
        return bytes32(uint(123456));
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        bytes32 preRetVal,
        uint256 gasUseWithoutPost,
        GSNTypes.GasData calldata gasData
    )
    external
    relayHubOnly
    {
        (context, gasUseWithoutPost, gasData);
        emit SampleRecipientPostCall(success, gasUseWithoutPost, preRetVal);
    }

    // TODO: this 'overrides' existing setRelayHub method
    function setHub(IRelayHub _relayHub) public {
        relayHub = _relayHub;
    }

    function deposit() public payable {
        require(address(relayHub) != address(0), "relay hub address not set");
        relayHub.depositFor.value(msg.value)(address(this));
    }

    function withdraw(address payable destination) public {
        require(address(relayHub) != address(0), "relay hub address not set");
        uint256 amount = relayHub.balanceOf(address(this));
        relayHub.withdraw(amount, destination);
    }
}
