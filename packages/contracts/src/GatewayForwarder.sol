// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "./forwarder/Forwarder.sol";

contract GatewayForwarder is Forwarder {
    address public immutable trustedRelayHub;

    constructor(address _trustedRelayHub) Forwarder() {
        trustedRelayHub = _trustedRelayHub;
    }

    function _verifySig(
        ForwardRequest calldata req,
        bytes32 domainSeparator,
        bytes32 requestTypeHash,
        bytes calldata suffixData,
        bytes calldata sig)
    internal
    override
    view
    {
        if (msg.sender != trustedRelayHub) {
            super._verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        }
    }
}
