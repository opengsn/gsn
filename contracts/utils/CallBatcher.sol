pragma solidity ^0.5.10;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";

library CallBatcher {
    using LibBytes for bytes;

    struct Call {
        address target;
        bytes callData;
    }

    //amount of gas needed by sendBatch to "gracefully" exit
    uint32 constant gasOverhead = 100;

    event outofgas(uint left, uint overhead);
    event gasaftercall(uint gasleft, uint gasBeforecall);
    /**
     * send multiple calls.
     * @param calls - array of calls to make
     * @param abortOnFirstRevert  - stop sending requests on first revert.
     *  if set to false, then continue to make all calls.
     * @return successfulCalls - counter on how many successful calls.
     * @return error - in case success at least one call failed, error contains
     *          the revert message of the first reverted call.
     *
     * This method will never revert.
     *
     * ## Gas usage: ##
     * Will attempt to execute as many calls as possible given the gaslimit.
     */
    function sendBatch(Call[] memory calls, bool abortOnFirstRevert)
    internal returns (uint successfulCalls, bytes memory error) {
        for (uint i = 0; i < calls.length; i++) {
            Call memory c = calls[i];
            uint gasLeft = gasleft();
            bool success;
            bytes memory ret;
            if (gasLeft < gasOverhead) {
                success = false;
                ret = "out-of-gas";
            } else {
                (success, ret) = c.target.call.gas(gasLeft - gasOverhead)(c.callData);
            }
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

    //send the batch. revert on first failure.
    // (since we perform a revert, there's no meaning for "continue after revert")
    function sendBatchAndRevert(Call[] memory calls) internal {
        (uint count, bytes memory error) = sendBatch(calls, true);
        require(count == calls.length, getErrorString(error));
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
