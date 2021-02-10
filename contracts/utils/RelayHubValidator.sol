// SPDX-License-Identifier:MIT
pragma solidity ^0.7.5;
pragma abicoder v2;

import "../interfaces/GsnTypes.sol";
library RelayHubValidator {

    // validate that encoded relayCall is properly packed without any extra bytes
    function verifyTransactionPacking(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    ) internal pure {
        uint expectedMsgDataLen = 4 + 22*32 +
        len1(signature) + len1(approvalData) + len1(relayRequest.request.data) + len1(relayRequest.relayData.paymasterData);
        require(signature.length <= 65, "invalid signature length");
        require(expectedMsgDataLen == msg.data.length, "extra msg.data bytes" );
    }

    // helper method for verifyTransactionPacking
    function len1(bytes calldata buf) internal pure returns (uint) {
        return 32 + ((buf.length+31) & uint(~31));
    }
}