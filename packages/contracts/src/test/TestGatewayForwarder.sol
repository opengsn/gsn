// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../forwarder/Forwarder.sol";

contract TestGatewayForwarder is Forwarder {
    address public trustedRelayHub;

    function setTrustedRelayHub(address _trustedRelayHub) external {
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
        // trustedRelayHub can only be called from a verified Gateway where the signatures are actually checked
        // note that if signature field is set, it will be verified in this Forwarder anyway
        if (msg.sender != trustedRelayHub || sig.length != 0) {
            super._verifySig(req, domainSeparator, requestTypeHash, suffixData, sig);
        }
    }
}
