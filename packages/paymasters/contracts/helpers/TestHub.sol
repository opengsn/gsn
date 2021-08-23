// SPDX-License-Identifier:MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/utils/GsnTypes.sol";
import "@opengsn/contracts/src/interfaces/IPaymaster.sol";

import "@opengsn/contracts/src/RelayHub.sol";

/**
 * This mock relay hub contract is only used to test the paymaster's 'pre-' and 'postRelayedCall' in isolation.
 */
contract TestHub is RelayHub {

    constructor(
        IStakeManager _stakeManager,
        address _penalizer,
        RelayHubConfig memory _config) RelayHub(_stakeManager,
        _penalizer,
        _config)
        // solhint-disable-next-line no-empty-blocks
    {}

    function callPreRC(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    returns (bytes memory context, bool revertOnRecipientRevert) {
        return IPaymaster(relayRequest.relayData.paymaster).preRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
    }

    function callPostRC(
        IPaymaster paymaster,
        bytes calldata context,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external {
        paymaster.postRelayedCall(context, true, gasUseWithoutPost, relayData);
    }
}
