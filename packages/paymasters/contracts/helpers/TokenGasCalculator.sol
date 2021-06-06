// SPDX-License-Identifier:MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@opengsn/contracts/src/RelayHub.sol";

import "../TokenPaymaster.sol";


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
        uint256 _externalCallDataCostOverhead) public RelayHub(_stakeManager,
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
    function calculatePostGas(TokenPaymaster paymaster) public returns (uint gasUsedByPost) {
        address paymasterAddress = address(paymaster);
        IERC20 token = paymaster.tokens(0);
        IUniswap uniswap = paymaster.uniswaps(0);
        require(token.balanceOf(address(this)) >= 1000, "calc: must have some tokens");
        require(paymaster.owner() == address(this), "calc: must be owner of paymaster");
        token.approve(paymasterAddress, uint(-1));
        token.approve(msg.sender, uint(-1));
        // emulate a "precharge"
        token.transfer(paymasterAddress, 500);

        paymaster.setRelayHub(IRelayHub(address(this)));

        GsnTypes.RelayData memory relayData = GsnTypes.RelayData(1, 0, 0, address(0), address(0), address(0), "", 0);

        bytes memory ctx1 = abi.encode(this, uint(500),token,uniswap);
        //with precharge
        uint gas0 = gasleft();
        paymaster.postRelayedCall(ctx1, true, 100, relayData);
        uint gas1 = gasleft();

        token.transferFrom(paymasterAddress, address(this), token.balanceOf(paymasterAddress));
        gasUsedByPost = gas0 - gas1;
        emit GasUsed(gasUsedByPost);
    }

    event GasUsed(uint gasUsedByPost);
}

