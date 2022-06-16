// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;
pragma experimental ABIEncoderV2;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryPayments.sol";

library UniswapV3Helper {
    // turn ERC-20 tokens into native unwrapped ETH at market price
    function swapToEth(
        address token,
        address weth,
        uint256 amountOut,
        uint24 fee,
        ISwapRouter uniswap
    ) internal {
        ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams(
            token, //tokenIn
            weth, //tokenOut
            fee,
            address(uniswap), //recipient - keep WETH at SwapRouter for withdrawal
            // solhint-disable-next-line not-rely-on-time
            block.timestamp, //deadline
            amountOut,
            type(uint256).max,
            0
        );

        uniswap.exactOutputSingle(params);
        // use "amountOut" as withdrawal's "amountMinimum" just in case
        IPeripheryPayments(address(uniswap)).unwrapWETH9(amountOut, address(this));
    }

    // swap ERC-20 tokens at market price
    function swapToToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee,
        ISwapRouter uniswap
    ) internal {
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams(
            tokenIn, //tokenIn
            tokenOut, //tokenOut
            fee,
            address(this), //recipient - keep WETH at SwapRouter for withdrawal
        // solhint-disable-next-line not-rely-on-time
            block.timestamp, //deadline
            amountIn,
            0,
            0
        );

        uniswap.exactInputSingle(params);
    }
}
