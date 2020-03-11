pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

//import "@nomiclabs/buidler/console.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";

//"library" with dry-run function.
//NOTE: since we actively call a method, we can't be a stand-alone library, and you must
// inherit this library
contract DryRun {

    //we try to estimate gas usage, but there's some "slack" due to our very test
    // (using "gasleft()")
    uint  callGasOverhead = 1000; // TODO: find proper value

    function setGasOverhead(uint a) internal {
        callGasOverhead = a;
    }

    /**
     * make a "dry-run" test on the given function
     * check if the given encodedFunction would revert.
     * NOTE: even when the function's execution is successful, all state-changes
     *  are reverted. That's why we call this a "dry-run"
     * @param from the "from" address to set (see note below)
     * @param target the contract to run the function
     * @param encodedFunction the function to run
     * @param gasLimit gas to give the call
     * return:
     *  success - true if the call would complete without revert, false otherwise
     *  err - in case success==false, the revert string
     *
     * @notice the sender is appended to the encoded function, so that a recipient can
     * use getSender() to extract it - but reciepient does NOT extract it unless the caller
     * is the RelayHub - so it must have a modified "gasSender", to accept this contract too.
     */
    function dryRun(address from, address target, bytes calldata encodedFunction, uint gasLimit) external returns (bool success, string memory err) {
        //note that we append "from" just like RelayHub, but for this to work,
        // the recipient must accept the sponsor as a "trusted caller", just like
        // a RelayHub (or else, it will check with the wrong sender)
        bytes memory callInner = abi.encodeWithSelector(
            this.internalRunAndRevert.selector,
            target, abi.encodePacked(encodedFunction, from), gasLimit);
        (bool neverSuccess, bytes memory buf) = address(this).call(callInner);
        (neverSuccess);
        bytes memory ret;
        (success, ret) = abi.decode(buf, (bool, bytes));
        err = getError(ret);
    }


    //check that the given function can be called successfully.
    // always revert with return value of (bool success, bytes revertData)
    //  success - true if succeeded, false if reverted
    //  revertData - if success==false, the revert returned data

    // NOTE: getSender() works correctly only when used from RelayHub
    function internalRunAndRevert(address target, bytes calldata encodedFunction, uint gasLimit) external {
        bool success;
        bytes memory ret;
        if (msg.sender != address(this)) {
            success=false;
            ret = abi.encodeWithSignature("Error(string)", "only from dryRun()");
        } else {
            uint gasBefore = gasleft();
            (success, ret) = target.call.gas(gasLimit )(encodedFunction);
            uint gasused = gasBefore - gasleft();
    //        console.log( "gas used success", gasused, success, ret.length);
            //try to translate revert caused by "out of gas" to readable message
            if (!success && ret.length == 0 && (gasLimit < callGasOverhead) || (gasused > gasLimit - callGasOverhead)) {
                ret = abi.encodeWithSignature("Error(string)", "out-of-gas");
            }
        }

        revertWithData(abi.encode(success, ret));
    }

    //extract the error string from a revert return value
    function getError(bytes memory err) internal pure returns (string memory ret) {
        if (err.length < 4 + 32)
            return string(err);
        //not a valid revert with error. return as-is.
        (ret) = abi.decode(LibBytes.slice(err, 4, err.length), (string));
    }

    function revertWithData(bytes memory data) private pure {
        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            revert(dataPtr, dataSize)
        }
    }
}
