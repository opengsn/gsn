/* solhint-disable */
// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/utils/GsnTypes.sol";
import "@opengsn/contracts/src/interfaces/IPaymaster.sol";
import "@opengsn/contracts/src/interfaces/IRelayHub.sol";

/**
 * This mock relay hub contract is only used to be called by a Gateway without creating the full GSN deployment
 */
contract BLSTestHub {
    event ReceivedRelayCall(address requestFrom, address requestTo);

    function relayCall(
        uint maxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    )
    external
    returns (bool paymasterAccepted, bytes memory returnValue){
        emit ReceivedRelayCall(relayRequest.request.from, relayRequest.request.to);
        return (true, '');
    }
}
