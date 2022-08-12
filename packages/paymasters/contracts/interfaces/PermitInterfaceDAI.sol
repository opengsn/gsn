// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface PermitInterfaceDAI is IERC20Metadata {
    function nonces(address holder) external view returns (uint256 nonce);

    // --- Approve by signature ---
    function permit(address holder, address spender, uint256 nonce, uint256 expiry,
        bool allowed, uint8 v, bytes32 r, bytes32 s) external;
}
