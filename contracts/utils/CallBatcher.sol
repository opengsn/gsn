pragma solidity ^0.5.10;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

library CallBatcher {
    using LibBytes for bytes;

    struct Call {
        address target;
        bytes callData;
    }

    function sendBatchAsTransaction(Call[] memory calls) internal {
        (uint successfulCalls, bytes memory error) = sendBatch(calls, true);
        require(successfulCalls == calls.length, getErrorString(error));
    }

    /**
     * send multiple calls.
     * @param calls - array of calls to make
     * @param abortOnFirstRevert  - stop sending requests on first revert.
     *  if set to false, then continue to make all calls.
     * @return successfulCalls - counter on how many successful calls.
     * @return error - in case success at least one call failed, error contains
     *          the revert message of the first reverted call.
     *
     * This method will never revert (unless it runs out of gas)
     */
    function sendBatch(Call[] memory calls, bool abortOnFirstRevert)
    internal returns (uint successfulCalls, bytes memory error) {
        for (uint i = 0; i < calls.length; i++) {
            Call memory c = calls[i];
            (bool success, bytes memory ret) = c.target.call(c.callData);
            if (success) {
                successfulCalls++;
            } else {
                if (error.length == 0) {
                    error = ret;
                }
                if (abortOnFirstRevert) {
                    break;
                }
            }
        }
    }

    //utility method for parsing returned data from address.call()
    // extract error string, or return buffer as-is.
    // usage:
    //```
    //  (uint count, bytes memory error) = CallBatcher.sendBatch(calls, abortOnFirst);
    //  require(count == calls.length, CallBatcher.getErrorString(error));
    //```

    function getErrorString(bytes memory error) internal pure returns (string memory) {
        //extract string from error message
        if (error.length >= 4 + 32 && error.readBytes4(0) == ErrorSig) {
            return abi.decode(error.slice(4, error.length), (string));
        }
        // otherwise, return buffer as-is.
        return string(error);
    }

    bytes4 constant ErrorSig = bytes4(keccak256("Error(string)"));
    //    bytes4 constant ErrorSig = 0x08c379a0;
}
