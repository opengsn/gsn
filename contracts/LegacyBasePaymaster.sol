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
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external override virtual
    returns (bytes memory context, bool isTrustedRecipient) {
        this._verifyForwarder(relayRequest);
        //NOTE: can't pass real signature, since we no longer get it.
        context = this.acceptRelayedCall(relayRequest, "", approvalData, maxPossibleGas);
        this.preRelayedCall(context);
        return (context, false);
    }
}
