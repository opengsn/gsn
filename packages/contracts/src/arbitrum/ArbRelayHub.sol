// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../RelayHub.sol";
import "./ArbSys.sol";

/**
 * @title The RelayHub Implementation for Arbitrum
 * @notice This contract implements the `IRelayHub` interface for the Arbitrum-compatible Rollups.
 *
 * @notice This implementation relies on the `ArbSys` built-ins that do not exist outside of Arbitrum.
 */
contract ArbRelayHub is RelayHub {

    /// @inheritdoc IRelayHub
    function versionHub() override public pure returns (string memory){
        return "3.0.0-beta.3+opengsn.arbhub.irelayhub";
    }

    ArbSys public immutable arbsys;
    uint256 internal immutable arbCreationBlock;

    /// @notice we accept the `ArbSys` address in the constructor to allow mocking it in tests.
    constructor(
        ArbSys _arbsys,
        IStakeManager _stakeManager,
        address _penalizer,
        address _batchGateway,
        address _relayRegistrar,
        RelayHubConfig memory _config
    ) RelayHub(_stakeManager, _penalizer, _batchGateway, _relayRegistrar, _config){
        arbsys = _arbsys;
        arbCreationBlock = _arbsys.arbBlockNumber();
    }

    /// @inheritdoc IRelayHub
    /// @notice Uses `ArbSys` L2 block number specific to the Arbitrum Rollup.
    function getCreationBlock() external override virtual view returns (uint256){
        return arbCreationBlock;
    }

    /// @return The block number in which the contract has been deployed.
    /// @notice Uses original L1 block number.
    function getL1CreationBlock() external view returns (uint256){
        return creationBlock;
    }

    /// @notice Includes the 'storage gas' specific to the Arbitrum Rollup.
    /// @inheritdoc IRelayHub
    function aggregateGasleft() public override virtual view returns (uint256){
        return arbsys.getStorageGasAvailable() + gasleft();
    }
}
