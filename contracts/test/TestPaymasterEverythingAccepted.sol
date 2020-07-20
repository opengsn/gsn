// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../forwarder/IForwarder.sol";
import "../BasePaymaster.sol";

contract TestPaymasterEverythingAccepted is BasePaymaster {

    function versionPaymaster() external view override virtual returns (string memory){
        return "2.0.0-alpha.3+opengsn.test_pea.ipaymaster";
    }

    event SampleRecipientPreCall();
    event SampleRecipientPostCall(bool success, uint actualCharge, bytes32 preRetVal);

    function acceptRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    view
    returns (bytes memory) {
        (relayRequest, approvalData, maxPossibleGas);
        GsnEip712Library.verify(relayRequest, signature);
        return "no revert here";
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
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    virtual
    relayHubOnly
    {
        (context, gasUseWithoutPost, relayData);
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
