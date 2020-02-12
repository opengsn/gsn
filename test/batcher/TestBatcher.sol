pragma solidity ^0.5.10;
pragma experimental ABIEncoderV2;

import "../../contracts/utils/CallBatcher.sol";

//a sample contract using the CallBatcher
contract TestBatcher {

    event BatchSent(address indexed sender, uint successful, string error);

    event Something(address msgsender, uint x);
    event Else(string x);

    //wrapper for sendBatch (since its internal)
    function sendBatch(CallBatcher.Call[] memory calls, bool abortOnFirst) public {
        (uint count, bytes memory error) = CallBatcher.sendBatch(calls, abortOnFirst);

        emit BatchSent(msg.sender, count, CallBatcher.getErrorString(error));
    }

    function sendBatchAsTransaction(CallBatcher.Call[] memory calls) public {

        CallBatcher.sendBatchAsTransaction(calls);
    }

    function somethingFailed() view public {
        (this);
        require(false, "called somethingFailed");
    }

    function something(uint x) public {
        emit Something(msg.sender, x);
    }

    function somethingElse(bool fail) public {
        require(!fail, "asked else to fail");
        emit Else("hello something else");
    }
}

