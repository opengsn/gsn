// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (token/ERC20/IERC20.sol)

pragma solidity >=0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @notice Extended ERC-20 token interface used internally in OpenGSN modules.
 * Renamed to avoid conflict with OZ namespace. Includes IERC20, ERC20Metadata.
 * added semi-standard "wrapped eth" access methods deposit() and "withdraw()"
 */
interface IERC20Token is IERC20, IERC20Metadata {

    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
