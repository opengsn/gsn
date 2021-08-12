/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../interfaces/IRelayHub.sol";

contract TestRelayWorkerContract {

    function relayCall(
        IRelayHub hub,
        uint maxAcceptanceBudget,
        GsnTypes.RelayRequest memory relayRequest,
        bytes memory signature,
        uint externalGasLimit)
    public
    {
        hub.relayCall{gas:externalGasLimit}(maxAcceptanceBudget, relayRequest, signature, "", externalGasLimit);
    }
}
