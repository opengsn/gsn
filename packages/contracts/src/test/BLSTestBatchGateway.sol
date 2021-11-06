// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "../utils/GsnTypes.sol";
import "../interfaces/IRelayHub.sol";
import "../../../paymasters/contracts/helpers/AllEvents.sol";

contract BLSTestBatchGateway is AllEvents {
    function sendBatch(IRelayHub relayHub, GsnTypes.RelayRequest[] memory relayRequests, uint256 maxAcceptanceBudget) public {
        for (uint256 i = 0; i < relayRequests.length; i++) {
            relayHub.relayCall(maxAcceptanceBudget, relayRequests[i], "", "");
        }
    }
}
