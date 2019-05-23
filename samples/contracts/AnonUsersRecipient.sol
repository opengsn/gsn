pragma solidity ^0.4.18;

import "../RelayRecipient.sol";

/**
 * A contract that accepts anonymous calls.
 * Anonymous calls should generally be avoided, since the contract may be
 * abused by attackers. E.g. a relay sending bogus high-fee transactions.
 * There are several ways to mitigate such abuse:
 * - accept anonymous calls for specific target methods and only from known relays.
 * - require the caller to perform some operation prior the call, so it is no longer anonymous.
 *   E.g. fill a captcha in a website and get a token which can be tested by acceptRelayedCall.
 */
contract AnonUsersRecipient is RelayRecipient {

    uint lastTimestamp;
    uint callCount;
	bytes methodSig;

    uint maxCallsPerHour;

    /**
     * save a valid method signature that we accept.
     * should be initialized from the constructor
     * a method signature can be obtained (as hex) with: web3.sha3("myMethod(uint256").slice(0,8)
     */
    function setValidSignature(bytes _sig) internal {
        methodSig = _sig;
    }
    /**
     */
    function acceptRelayedCall(address /*relay*/, address /*from*/, bytes functionCall, uint /*gasPrice*/, uint /*transactionFee*/ ) external view returns(uint) {

        //validate this is a method call we accept:
        for ( uint i=0; i< methodSig.length; i++ ) {
            if ( methodSig[i] != functionCall[i] )
                return 11;
        }
        //throttle # of calls per hour:
        if ( callCount > maxCallsPerHour) return 12;
        return 0;
    }

    function postRelayedCall(address /*relay*/, address /*from*/, bytes /*encodedFunction*/, bool /*success*/, uint /*usedGas*/, uint /*transactionFee*/ ) external {

        if ( block.timestamp - lastTimestamp > 3600 ) {
            callCount = 0;
            lastTimestamp = block.timestamp;
        }
        callCount = callCount +1;
    }

}
