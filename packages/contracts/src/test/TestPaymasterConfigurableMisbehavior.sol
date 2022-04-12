// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./TestPaymasterEverythingAccepted.sol";

contract TestPaymasterConfigurableMisbehavior is TestPaymasterEverythingAccepted {

    bool public withdrawDuringPostRelayedCall;
    bool public withdrawDuringPreRelayedCall;
    bool public returnInvalidErrorCode;
    bool public revertPostRelayCall;
    bool public outOfGasPre;
    bool public revertPreRelayCall;
    bool public revertPreRelayCallOnEvenBlocks;
    bool public greedyAcceptanceBudget;
    bool public expensiveGasLimits;

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
    function setRevertPreRelayCallOnEvenBlocks(bool val) public {
        revertPreRelayCallOnEvenBlocks = val;
    }
    function setOutOfGasPre(bool val) public {
        outOfGasPre = val;
    }

    function setGreedyAcceptanceBudget(bool val) public {
        greedyAcceptanceBudget = val;
    }
    function setExpensiveGasLimits(bool val) public {
        expensiveGasLimits = val;
    }

    // solhint-disable-next-line no-empty-blocks
    function _verifyApprovalData(bytes calldata approvalData) internal virtual override view {}

    // solhint-disable-next-line no-empty-blocks
    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {}

    // solhint-disable reason-string
    // contains comments that are checked in tests
    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    returns (bytes memory, bool) {
        (relayRequest, signature, approvalData, maxPossibleGas);
        if (outOfGasPre) {
            uint256 i = 0;
            while (true) {
                i++;
            }
        }

        require(!returnInvalidErrorCode, "invalid code");

        if (withdrawDuringPreRelayedCall) {
            withdrawAllBalance();
        }
        if (revertPreRelayCall) {
            revert("You asked me to revert, remember?");
        }
        if (revertPreRelayCallOnEvenBlocks && block.number % 2 == 0) {
            revert("You asked me to revert on even blocks, remember?");
        }
        return ("", trustRecipientRevert);
    }

    function _postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal
    override
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
        relayHub.withdraw(payable(address(this)), balance);
        return balance;
    }

    IPaymaster.GasAndDataLimits private limits = super.getGasAndDataLimits();

    function getGasAndDataLimits()
    public override view
    returns (IPaymaster.GasAndDataLimits memory) {

        if (expensiveGasLimits) {
            uint256 sum;
            //memory access is 700gas, so we waste ~50000
            for ( int i=0; i<100000; i+=700 ) {
                sum  = sum + limits.acceptanceBudget;
            }
        }
        if (greedyAcceptanceBudget) {
            return IPaymaster.GasAndDataLimits(limits.acceptanceBudget * 9, limits.preRelayedCallGasLimit, limits.postRelayedCallGasLimit,
            limits.calldataSizeLimit);
        }
        return limits;
    }

    bool private trustRecipientRevert;

    function setGasLimits(uint256 acceptanceBudget, uint256 preRelayedCallGasLimit, uint256 postRelayedCallGasLimit) public {
        limits = IPaymaster.GasAndDataLimits(
            acceptanceBudget,
            preRelayedCallGasLimit,
            postRelayedCallGasLimit,
            limits.calldataSizeLimit
        );
    }

    function setTrustRecipientRevert(bool on) public {
        trustRecipientRevert = on;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external override payable {}
}
