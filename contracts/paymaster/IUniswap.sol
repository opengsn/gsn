pragma solidity ^0.5.16;

//minimal uniswap we need:
interface IUniswap {
    function tokenAddress() external view returns (address);

    function tokenToEthSwapOutput(uint256 eth_bought, uint256 max_tokens, uint256 deadline) external returns (uint256 out);

    function tokenToEthTransferOutput(uint256 eth_bought, uint256 max_tokens, uint256 deadline, address payable recipient) external returns (uint256 out);

    function getTokenToEthOutputPrice(uint256 eth_bought) external view returns (uint256 out);

    function getTokenToEthInputPrice(uint256 tokens_sold) external view returns (uint256 out);
}
