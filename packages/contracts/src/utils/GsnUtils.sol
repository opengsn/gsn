/* solhint-disable no-inline-assembly */
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../utils/MinLibBytes.sol";
import "./GsnTypes.sol";

/**
 * @title The GSN Solidity Utils Library
 * @notice Some library functions used throughout the GSN Solidity codebase.
 */
library GsnUtils {

    bytes32 constant private RELAY_REQUEST_ID_MASK = 0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

    /**
     * @notice Calculate an identifier for the meta-transaction in a format similar to a transaction hash.
     * Note that uniqueness relies on signature and may not be enforced if meta-transactions are verified
     * with a different algorithm, e.g. when batching.
     * @param relayRequest The `RelayRequest` for which an ID is being calculated.
     * @param signature The signature for the `RelayRequest`. It is not validated here and may even remain empty.
     */
    function getRelayRequestID(GsnTypes.RelayRequest calldata relayRequest, bytes calldata signature)
    internal
    pure
    returns (bytes32) {
        return keccak256(abi.encode(relayRequest.request.from, relayRequest.request.nonce, signature)) & RELAY_REQUEST_ID_MASK;
    }

    /**
     * @notice Extract the method identifier signature from the encoded function call.
     */
    function getMethodSig(bytes memory msgData) internal pure returns (bytes4) {
        return MinLibBytes.readBytes4(msgData, 0);
    }

    /**
     * @notice Extract a parameter from encoded-function block.
     * see: https://solidity.readthedocs.io/en/develop/abi-spec.html#formal-specification-of-the-encoding
     * The return value should be casted to the right type (`uintXXX`/`bytesXXX`/`address`/`bool`/`enum`).
     * @param msgData Byte array containing a uint256 value.
     * @param index Index in byte array of uint256 value.
     * @return result uint256 value from byte array.
     */
    function getParam(bytes memory msgData, uint256 index) internal pure returns (uint256 result) {
        return MinLibBytes.readUint256(msgData, 4 + index * 32);
    }

    /// @notice Re-throw revert with the same revert data.
    function revertWithData(bytes memory data) internal pure {
        assembly {
            revert(add(data,32), mload(data))
        }
    }

}
