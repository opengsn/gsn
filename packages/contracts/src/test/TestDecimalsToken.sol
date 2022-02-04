// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestDecimalsToken is ERC20 {

    constructor() ERC20("Test Token", "DEC") {
        mint(100 ether);
    }

    function mint(uint amount) public {
        _mint(msg.sender, amount);
    }

    uint8 private _decimals;

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 _dec) public {
        _decimals = _dec;
    }
}
