// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../RelayHub.sol";
import "./ArbSys.sol";

contract ArbRelayHub is RelayHub {
    ArbSys public immutable arbsys;

    // note: we accept the 'ArbSys' address in the constructor to allow mocking it in tests
    constructor(
        ArbSys _arbsys,
        IStakeManager _stakeManager,
        address _penalizer,
        RelayHubConfig memory _config
    ) RelayHub(_stakeManager, _penalizer, _config){
        arbsys = _arbsys;
    }

    function aggregateGasleft() public override virtual view returns (uint256){
        return arbsys.getStorageGasAvailable() + gasleft();
    }
}
