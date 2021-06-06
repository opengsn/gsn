// SPDX-License-Identifier:MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20("Test Token", "TOK") {

    function mint(uint amount) public {
        _mint(msg.sender, amount);
    }
}
