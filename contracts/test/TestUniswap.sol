pragma solidity ^0.5.16;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "../paymaster/IUniswap.sol";

contract TestToken is ERC20 {
    function mint(uint amount) public {
        _mint(msg.sender, amount);
    }
}

//naive, no-calculation swapper.
//- the exchange rate is fixed at construction
//- mints new tokens at will...
contract TestUniswap is IUniswap {
    IERC20 public token;
    uint public rateMult;
    uint public rateDiv;

    constructor(uint _rateMult, uint _rateDiv) public payable {
        token = new TestToken();
        rateMult = _rateMult;
        rateDiv = _rateDiv;
        require(msg.value > 0, "must specify liquidity");
        require(rateMult != 0 && rateDiv != 0, "bad mult,div");
    }

    function() external payable {}

    function tokenAddress() external view returns (address out) {
        return address(token);
    }

    function tokenToEthSwapOutput(uint256 eth_bought, uint256 max_tokens, uint256 deadline) public returns (uint256 out) {
        (max_tokens, deadline);
        uint tokensToSell = getTokenToEthOutputPrice(eth_bought);
        require(address(this).balance > eth_bought, "not enough liquidity");

        token.transferFrom(msg.sender, address(this), tokensToSell);
        msg.sender.transfer(eth_bought);
        return tokensToSell;
    }

    function getTokenToEthInputPrice(uint256 tokens_sold) external view returns (uint256 out) {
        return tokens_sold * rateDiv / rateMult;
    }

    function tokenToEthTransferOutput(uint256 eth_bought, uint256 max_tokens, uint256 deadline, address payable recipient) external returns (uint256 out) {
        (max_tokens, deadline, recipient);
        require(address(this).balance > eth_bought, "not enough liquidity");

        uint tokensToSell = getTokenToEthOutputPrice(eth_bought);

        token.transferFrom(msg.sender, address(this), tokensToSell);
        recipient.transfer(eth_bought);
        return tokensToSell;
    }

    function getTokenToEthOutputPrice(uint256 eth_bought) public view returns (uint256 out) {
        return eth_bought * rateMult / rateDiv;
    }
}
