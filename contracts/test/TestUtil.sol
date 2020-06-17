// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../interfaces/GsnTypes.sol";
import "../utils/GsnEip712Library.sol";
import "../utils/GsnUtils.sol";

contract TestUtil {


    //helpers for test to call the library funcs:
    function callForwarderVerify(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    view {
        GsnEip712Library.verify(relayRequest, signature);
    }

    function callForwarderVerifyAndCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature
    )
    external
    returns (
        bool success,
        bytes memory ret
    ) {
        (success, ret) = GsnEip712Library.execute(relayRequest,signature);
        emit Called(success,ret, success==false ? GsnUtils.getError(ret):"");
    }

    event Called(bool success, bytes ret, string error);

    function splitRequest(
        GsnTypes.RelayRequest calldata relayRequest
    )
    external
    pure
    returns (
        Eip712Forwarder.ForwardRequest memory forwardRequest,
        bytes32 typeHash,
        bytes memory suffixData
    ) {
        (forwardRequest, suffixData) = GsnEip712Library.splitRequest(relayRequest);
        typeHash = GsnEip712Library.RELAY_REQUEST_TYPEHASH;
    }
}
