pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./TestSponsorEverythingAccepted.sol";

contract TestSponsorConfigurableMisbehavior is TestSponsorEverythingAccepted {

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
        EIP712Sig.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    view
    returns (uint256, bytes memory){
        (relayRequest);
        if (overspendAcceptGas) {
            uint i = 0;
            while (true) {
                i++;
            }
        }

        if (returnInvalidErrorCode) return (10, "");

        return (0, "");
    }

    function preRelayedCall(bytes calldata context) relayHubOnly external returns (bytes32) {
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
        uint actualCharge,
        bytes32 preRetVal)
    relayHubOnly
    external
    {
        if (withdrawDuringPostRelayedCall) {
            withdrawAllBalance();
        }
        if (revertPostRelayCall) {
            revert("You asked me to revert, remember?");
        }
    }

    ///  leaving withdrawal public and unprotected
    function withdrawAllBalance() public returns (uint256) {
        require(address(relayHub) != address(0), 'relay hub address not set');
        uint256 balance = relayHub.balanceOf(address(this));
        relayHub.withdraw(balance, address(this));
        return balance;
    }

    function() external payable {}
}
