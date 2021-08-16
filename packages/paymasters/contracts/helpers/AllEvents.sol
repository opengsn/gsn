// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;

/**
 * In order to help the Truffle tests to decode events in the transactions' results,
 * the events must be declared in a top-level contract.
 * Implement this empty interface in order to add event signatures to any contract.
 *
 */
interface AllEvents {
    event Received(address indexed sender, uint256 eth);
    event Withdrawal(address indexed src, uint wad);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 ethActualCharge);

    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );
}
