// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
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
    override
    virtual
    view
    returns (bytes memory) {
        (relayRequest, approvalData, maxPossibleCharge);
        return "";
    }

    function preRelayedCall(
        bytes calldata context
    )
    external
    override
    virtual
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
    override
    virtual
    relayHubOnly
    {
        (context, gasUseWithoutPost, gasData);
        emit SampleRecipientPostCall(success, gasUseWithoutPost, preRetVal);
    }

    function deposit() public payable {
        require(address(relayHub) != address(0), "relay hub address not set");
        relayHub.depositFor{value:msg.value}(address(this));
    }

    function withdrawAll(address payable destination) public {
        uint256 amount = relayHub.balanceOf(address(this));
        withdrawRelayHubDepositTo(amount, destination);
    }
}
