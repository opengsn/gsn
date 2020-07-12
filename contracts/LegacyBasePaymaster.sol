// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./BasePaymaster.sol";

/**
 * Abstract base class for LEGACY paymasters, written with previous API using acceptRelayedCall
 * This paymaster implements the new preRelayedCall, and call the legacy acceptRelayedCall/preRelayedCall
 * The change to the existing paymaster should be:
 *  - remove relayHubOnly from preRelayedCall (since it will be called by self)
 *  - extend this class instead of BasePaymaster
 *  - should not make any assumption on gas limits (since we've changed their meaning)
 */
abstract contract LegacyBasePaymaster is BasePaymaster {


    //Paymaster is commited to pay for any reverted transaction above the commitment. it covers both preRelayedCall aod
    // forwrader's check for nonce/signature.
    // we assume 50k is more than enough for forwarder (10k bytes request takes ~30kgas)
    uint256 constant private COMMITMENT_GAS_LIMIT = 150000;
    //any revert in preRelayedCall is within "commitment"
    uint256 constant private PRE_RELAYED_CALL_GAS_LIMIT = 100000;
    uint256 constant private POST_RELAYED_CALL_GAS_LIMIT = 110000;

    function getGasLimits()
    external
    override
    view
    returns (
        IPaymaster.GasLimits memory limits
    ) {
        return IPaymaster.GasLimits(
            COMMITMENT_GAS_LIMIT,
            PRE_RELAYED_CALL_GAS_LIMIT,
            POST_RELAYED_CALL_GAS_LIMIT
        );
    }

    // "legacy mode" acceptRelayedCall
    function acceptRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    virtual
    view
    returns (bytes memory context);

    // "legacy mode" preRelayedCall
    // (NOTE: return balue is ignored, since new postRelayedCall can use the "context"
    // for that purpose)
    function preRelayedCall(bytes calldata context) external virtual returns (bytes32);

    //TEMPORARY: compatibility mode: use "old" pre/post for making the "newPreRelayedCall"
    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external override virtual
    returns (bytes memory context, bool isTrustedRecipient) {
        require( relayRequest.relayData.forwarder == address(trustedForwarder), "paymaster: unsupported forwarder");
        context = this.acceptRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
        this.preRelayedCall(context);
        return (context, false);
    }
}
