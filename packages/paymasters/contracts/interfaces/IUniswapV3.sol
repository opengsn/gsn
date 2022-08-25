// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;

//minimal uniswap we need:
interface IUniswapV3 {
    function tokenAddress() external view returns (address);

    function tokenToEthSwapOutput(uint256 ethBought, uint256 maxTokens, uint256 deadline) external returns (uint256 out);

    function tokenToEthTransferOutput(uint256 ethBought, uint256 maxTokens, uint256 deadline, address payable recipient) external returns (uint256 out);

    function getTokenToEthOutputPrice(uint256 ethBought) external view returns (uint256 out);

    function getTokenToEthInputPrice(uint256 tokensSold) external view returns (uint256 out);

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

}
