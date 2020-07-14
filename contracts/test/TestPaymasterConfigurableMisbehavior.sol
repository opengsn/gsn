// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterConfigurableMisbehavior is TestPaymasterEverythingAccepted {

    bool public withdrawDuringPostRelayedCall;
    bool public withdrawDuringPreRelayedCall;
    bool public returnInvalidErrorCode;
    bool public revertPostRelayCall;
    bool public overspendAcceptGas;
    bool public revertPreRelayCall;

    function setWithdrawDuringPostRelayedCall(bool val) public {
        withdrawDuringPostRelayedCall = val;
    }
    function setWithdrawDuringPreRelayedCall(bool val) public {
        withdrawDuringPreRelayedCall = val;
    }
    function setReturnInvalidErrorCode(bool val) public {
        returnInvalidErrorCode = val;
    }
    function setRevertPostRelayCall(bool val) public {
        revertPostRelayCall = val;
    }
    function setRevertPreRelayCall(bool val) public {
        revertPreRelayCall = val;
    }
    function setOverspendAcceptGas(bool val) public {
        overspendAcceptGas = val;
    }

    function acceptRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    view
    returns (bytes memory) {
        (relayRequest, signature, approvalData, maxPossibleGas);
        if (overspendAcceptGas) {
            uint i = 0;
            while (true) {
                i++;
            }
        }

        require(!returnInvalidErrorCode, "invalid code");

        return "";
    }

    function preRelayedCall(bytes calldata context)
    external
    override
    returns (bytes32) {
        (context);
        if (withdrawDuringPreRelayedCall) {
            withdrawAllBalance();
        }
        if (revertPreRelayCall) {
            revert("You asked me to revert, remember?");
        }
        return 0;
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    relayHubOnly
    {
        (context, success, gasUseWithoutPost, relayData);
        if (withdrawDuringPostRelayedCall) {
            withdrawAllBalance();
        }
        if (revertPostRelayCall) {
            revert("You asked me to revert, remember?");
        }
    }

    /// leaving withdrawal public and unprotected
    function withdrawAllBalance() public returns (uint256) {
        require(address(relayHub) != address(0), "relay hub address not set");
        uint256 balance = relayHub.balanceOf(address(this));
        relayHub.withdraw(balance, address(this));
        return balance;
    }

    IPaymaster.GasLimits private limits = IPaymaster.GasLimits(
        COMMITMENT_GAS_LIMIT,
        PRE_RELAYED_CALL_GAS_LIMIT,
        POST_RELAYED_CALL_GAS_LIMIT
    );

    function getGasLimits()
    external override view
    returns (IPaymaster.GasLimits memory) {
        return limits;
    }

    bool private trustRecipientRevert;

    function setGasLimits(uint commitmentGasLimit, uint preRelayedCallGasLimit, uint postRelayedCallGasLimit) public {
        limits = IPaymaster.GasLimits(
            commitmentGasLimit,
            preRelayedCallGasLimit,
            postRelayedCallGasLimit
        );
    }

    function setTrustRecipientRevert(bool on) public {
        trustRecipientRevert = on;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external override payable {}
}
