// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IUniswap.sol";
import "./TestToken.sol";

// naive, no-calculation swapper.
//- the exchange rate is fixed at construction
//- mints new tokens at will...
contract TestUniswap is IUniswap {
    IERC20 public token;
    uint public rateMult;
    uint public rateDiv;

    constructor(uint _rateMult, uint _rateDiv) payable {
        token = new TestToken();
        rateMult = _rateMult;
        rateDiv = _rateDiv;
        require(msg.value > 0, "must specify liquidity");
        require(rateMult != 0 && rateDiv != 0, "bad mult,div");
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    function tokenAddress() external override view returns (address out) {
        return address(token);
    }

    function tokenToEthSwapOutput(uint256 ethBought, uint256 maxTokens, uint256 deadline) public override returns (uint256 out) {
        (maxTokens, deadline);
        uint tokensToSell = getTokenToEthOutputPrice(ethBought);
        require(address(this).balance > ethBought, "not enough liquidity");

        token.transferFrom(msg.sender, address(this), tokensToSell);
        payable(msg.sender).transfer(ethBought);
        return tokensToSell;
    }

    function getTokenToEthInputPrice(uint256 tokensSold) external override view returns (uint256 out) {
        return tokensSold * rateDiv / rateMult;
    }

    function tokenToEthTransferOutput(uint256 ethBought, uint256 maxTokens, uint256 deadline, address payable recipient) external override returns (uint256 out) {
        (maxTokens, deadline, recipient);
        require(address(this).balance > ethBought, "not enough liquidity");

        uint tokensToSell = getTokenToEthOutputPrice(ethBought);

        token.transferFrom(msg.sender, address(this), tokensToSell);
        recipient.transfer(ethBought);
        return tokensToSell;
    }

    function getTokenToEthOutputPrice(uint256 ethBought) public override view returns (uint256 out) {
        return ethBought * rateMult / rateDiv;
    }
}
