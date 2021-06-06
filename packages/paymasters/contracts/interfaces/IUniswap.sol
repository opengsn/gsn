// SPDX-License-Identifier:MIT
pragma solidity ^0.7.6;

//minimal uniswap we need:
interface IUniswap {
    function tokenAddress() external view returns (address);

    function tokenToEthSwapOutput(uint256 ethBought, uint256 maxTokens, uint256 deadline) external returns (uint256 out);

    function tokenToEthTransferOutput(uint256 ethBought, uint256 maxTokens, uint256 deadline, address payable recipient) external returns (uint256 out);

    function getTokenToEthOutputPrice(uint256 ethBought) external view returns (uint256 out);

    function getTokenToEthInputPrice(uint256 tokensSold) external view returns (uint256 out);
}
