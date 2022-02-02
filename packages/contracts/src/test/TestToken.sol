// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {

    constructor() ERC20("Test Token", "TOK") {
        mint(100 ether);
    }

    function mint(uint256 amount) public {
        _mint(msg.sender, amount);
    }
}
