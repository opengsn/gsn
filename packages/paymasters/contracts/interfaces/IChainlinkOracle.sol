// SPDX-License-Identifier:MIT
pragma solidity ^0.7.6;

interface IChainlinkOracle {
    function decimals()
    external
    view
    returns (
        uint8
    );

    function latestAnswer() external view returns (int256);
}
