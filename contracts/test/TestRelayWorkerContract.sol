/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier:MIT
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

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
