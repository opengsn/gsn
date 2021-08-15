// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@opengsn/contracts/src/RelayHub.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";

/**
 * Calculate the postRelayedCall gas usage for a TokenPaymaster.
 *
 */
contract TokenGasCalculator is RelayHub {

    //(The Paymaster calls back calculateCharge, depositFor in the relayHub,
    //so the calculator has to implement them just like a real RelayHub
    // solhint-disable-next-line no-empty-blocks
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

    /**
     * calculate actual cost of postRelayedCall.
     * usage:
     * - create this calculator.
     * - create an instance of your TokenPaymaster, with your token's Uniswap instance.
     * - move some tokens (1000 "wei") to the calculator (msg.sender is given approval to pull them back at the end)
     * - set the calculator as owner of this calculator.
     * - call this method.
     * - use the returned values to set your real TokenPaymaster.setPostGasUsage()
     * the above can be ran on a "forked" network, so that it will have the real token, uniswap instances,
     * but still leave no side-effect on the network.
     */
    function calculatePostGas(
        BasePaymaster paymaster,
        bytes memory ctx1
    ) public returns (uint gasUsedByPost) {
        GsnTypes.RelayData memory relayData = GsnTypes.RelayData(1, 0, 0, address(0), address(0), address(0), "", 0);

        //with precharge
        uint gas0 = gasleft();
        paymaster.postRelayedCall(ctx1, true, 100, relayData);
        uint gas1 = gasleft();
        gasUsedByPost = gas0 - gas1;
        emit GasUsed(gasUsedByPost);
    }

    event GasUsed(uint gasUsedByPost);
}

