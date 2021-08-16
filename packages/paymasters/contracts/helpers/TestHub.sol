// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/utils/GsnTypes.sol";
import "@opengsn/contracts/src/interfaces/IPaymaster.sol";

import "@opengsn/contracts/src/RelayHub.sol";

import "./AllEvents.sol";

/**
 * This mock relay hub contract is only used to test the paymaster's 'pre-' and 'postRelayedCall' in isolation.
 */
contract TestHub is RelayHub, AllEvents {

    constructor(
        IStakeManager _stakeManager,
        address _penalizer,
        uint256 _maxWorkerCount,
        uint256 _gasReserve,
        uint256 _postOverhead,
        uint256 _gasOverhead,
        uint256 _maximumRecipientDeposit,
        uint256 _minimumUnstakeDelay,
        uint256 _minimumStake,
        uint256 _dataGasCostPerByte,
        uint256 _externalCallDataCostOverhead) RelayHub(_stakeManager,
        _penalizer,
        _maxWorkerCount,
        _gasReserve,
        _postOverhead,
        _gasOverhead,
        _maximumRecipientDeposit,
        _minimumUnstakeDelay,
        _minimumStake,
        _dataGasCostPerByte,
        _externalCallDataCostOverhead)
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
