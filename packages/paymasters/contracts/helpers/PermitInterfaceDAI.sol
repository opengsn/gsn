// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface PermitInterfaceDAI is IERC20 {
    function nonces(address holder) external view returns (uint256 nonce);

    // --- Approve by signature ---
    function permit(address holder, address spender, uint256 nonce, uint256 expiry,
        bool allowed, uint8 v, bytes32 r, bytes32 s) external;
}
