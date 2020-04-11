pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./TokenPaymaster.sol";
import "../RelayHub.sol";


/**
 * Calculate the postRelayedCall gas usage for a TokenPaymaster.
 *
 */
contract TokenGasCalculator is RelayHub, Ownable {

    //(The Paymaster calls back calculateCharge, deposotFor in the relayHub,
    //so the calculator has to implement them just like a real RelayHub
    // solhint-disable-next-line no-empty-blocks
    constructor(uint256 _gtxdatanonzero, StakeManager _stakeManager, Penalizer _penalizer) public RelayHub(_gtxdatanonzero, _stakeManager, _penalizer) {}

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
    function calculatePostGas(TokenPaymaster paymaster) public onlyOwner returns (uint gasUsedByPostWithPreCharge, uint gasUsedByPostWithoutPreCharge) {

        address paymasterAddress = address(paymaster);
        IERC20 token = paymaster.token();
        require(token.balanceOf(address(this)) >= 1000, "must move some tokens to calculator first");
        require(paymaster.owner() == address(this), "must set calculator as owner of paymaster");
        token.approve(paymasterAddress, uint(-1));
        token.approve(msg.sender, uint(-1));
        // emulate a "precharge"
        token.transfer(paymasterAddress, 500);

        paymaster.setRelayHub(IRelayHub(address(this)));

        GSNTypes.GasData memory gasData = GSNTypes.GasData(0, 1, 0, 0);
        bytes memory ctx0 = abi.encode(this, uint(0));
        //no precharge
        bytes memory ctx1 = abi.encode(this, uint(500));
        //with precharge
        uint gasinit = gasleft();
        paymaster.postRelayedCall(ctx0, true, bytes32(0), 100, gasData);
        uint gas0 = gasleft();
        paymaster.postRelayedCall(ctx1, true, bytes32(0), 100, gasData);
        uint gas1 = gasleft();

        token.transferFrom(paymasterAddress, address(this), token.balanceOf(paymasterAddress));
        gasUsedByPostWithoutPreCharge = gasinit - gas0;
        gasUsedByPostWithPreCharge = gas0 - gas1;
        emit GasUsed(gasUsedByPostWithPreCharge, gasUsedByPostWithoutPreCharge);
    }

    //called by postRelayedCall. copied from RelayHub
    function calculateCharge(uint256 gasUsed, GSNTypes.GasData memory gasData) public view returns (uint256) {
        return gasData.baseRelayFee + (gasUsed * gasData.gasPrice * (100 + gasData.pctRelayFee)) / 100;
    }

    event GasUsed(uint gasUsedByPostWithPreCharge, uint gasUsedByPostWithoutPreCharge);
}

