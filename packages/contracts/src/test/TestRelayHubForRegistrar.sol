// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../RelayHub.sol";

contract TestRelayHubForRegistrar {
    mapping(address => bool) public isStaked;

    function setRelayManagerStaked(address relayManager, bool _isStaked) external {
        isStaked[relayManager] = _isStaked;
    }

    function verifyCanRegister(address relayManager) external view {
        require(isStaked[relayManager], "verifyCanRegister: cannot");
    }

    function verifyRelayManagerStaked(address relayManager) external view {
        require(isStaked[relayManager], "verifyRelayManagerStaked: is not");
    }

    function onRelayServerRegistered(address relayManager) external view {
        require(isStaked[relayManager], "onRelayServerRegistered no stake");
    }
}
