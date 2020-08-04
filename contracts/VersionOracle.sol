// SPDX-License-Identifier:MIT
pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VersionOracle is Ownable {

    struct Deployment {
        address relayHubAddress;
        address stakeManagerAddress;
        address penalizerAddress;
    }

    mapping(uint256 => Deployment) private deployments;

    function setDeployment(uint256 apiLevel, Deployment memory deployment) external onlyOwner {
        deployments[apiLevel] = deployment;
    }

    function getDeployment(uint256 apiLevel) external view returns (Deployment memory deployment) {
        deployment = deployments[apiLevel];
    }

}
