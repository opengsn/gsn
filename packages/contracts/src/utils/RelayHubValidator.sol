// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../utils/GsnTypes.sol";

/**
 * @title The RelayHub Validator Library
 * @notice Validates the `msg.data` received by the `RelayHub` does not contain unnecessary bytes.
 * Including these extra bytes would allow the Relay Server to inflate transaction costs and overcharge the client.
 */
library RelayHubValidator {

    /// @notice Validate that encoded `relayCall` is properly packed without any extra bytes
    function verifyTransactionPacking(
        string calldata domainSeparatorName,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    ) internal pure {
        // abicoder v2: https://docs.soliditylang.org/en/latest/abi-spec.html
        // each static param/member is 1 word
        // struct (with dynamic members) has offset to struct which is 1 word
        // dynamic member is 1 word offset to actual value, which is 1-word length and ceil(length/32) words for data
        // relayCall has 5 method params,
        // relayRequest: 2 members
        // relayData 8 members
        // ForwardRequest: 7 members
        // total 21 32-byte words if all dynamic params are zero-length.
        uint256 expectedMsgDataLen = 4 + 22 * 32 +
            dynamicParamSize(bytes(domainSeparatorName)) +
            dynamicParamSize(signature) +
            dynamicParamSize(approvalData) +
            dynamicParamSize(relayRequest.request.data) +
            dynamicParamSize(relayRequest.relayData.paymasterData);
        // zero-length signature is allowed in a batch relay transaction
        require(expectedMsgDataLen == msg.data.length, "extra msg.data bytes" );
    }

    // helper method for verifyTransactionPacking:
    // size (in bytes) of the given "bytes" parameter. size include the length (32-byte word),
    // and actual data size, rounded up to full 32-byte words
    function dynamicParamSize(bytes calldata buf) internal pure returns (uint256) {
        return 32 + ((buf.length + 31) & (type(uint256).max - 31));
    }
}
