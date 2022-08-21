// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@opengsn/contracts/src/RelayHub.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";
import "./AllEvents.sol";

/**
 * Calculate the postRelayedCall gas usage for a TokenPaymaster.
 *
 */
contract TokenGasCalculator is RelayHub, AllEvents {

    //(The Paymaster calls back calculateCharge, depositFor in the relayHub,
    //so the calculator has to implement them just like a real RelayHub
    // solhint-disable-next-line no-empty-blocks
    constructor(
        IStakeManager _stakeManager,
        address _penalizer,
        address _batchGateway,
        address _relayRegistrar,
        RelayHubConfig memory _config) RelayHub(_stakeManager,
        _penalizer,
        _batchGateway,
        _relayRegistrar,
        _config)
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
        bytes memory ctx1,
        bytes memory paymasterData
    ) public returns (uint256 gasUsedByPost) {
        GsnTypes.RelayData memory relayData = GsnTypes.RelayData(1, 1, 0, address(0), address(0), address(0), paymasterData, 0);

        //with precharge
        uint256 gas0 = gasleft();
        paymaster.postRelayedCall(ctx1, true, 100, relayData);
        uint256 gas1 = gasleft();
        gasUsedByPost = gas0 - gas1;
        emit GasUsed(gasUsedByPost);
    }

    event GasUsed(uint256 gasUsedByPost);
}

