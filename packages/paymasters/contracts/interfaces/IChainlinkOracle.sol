// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;

interface IChainlinkOracle {
    function decimals()
    external
    view
    returns (
        uint8
    );

    function latestAnswer() external view returns (int256);
}
