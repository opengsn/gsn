pragma solidity 0.5.16;

contract IUniswap {
    function tokenAddress() external view returns (address out);

    function tokenToEthSwapOutput(
        uint256 eth_bought,
        uint256 max_tokens,
        uint256 deadline)
    external
    returns
    (uint256 out);

    function getTokenToEthOutputPrice(
        uint256 eth_bought)
    external
    view
    returns
    (uint256 out);

    function addLiquidity(
        uint256 min_liquidity,
        uint256 max_tokens,
        uint256 deadline)
    external
    payable
    returns
    (uint256 out);
}
