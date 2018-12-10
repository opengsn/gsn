pragma solidity ^0.4.18;

import "../RelayRecipient.sol";

/**
 * A contract that accepts anonymous calls.
 * Anonymous calls should generally be avoided, since the contract may be
 * abused by attackers. E.g. a relay sending bogus high-fee transactions.
 * There are several ways to mitigate such abuse:
 * - accept anonymous calls for specific target methods and only from known relays.
 * - require the caller to perform some operation prior the call, so it is no longer anonymous.
 *   E.g. fill a captcha in a website and get a token which can be tested by may_relay.
 */
contract AnonUsersRecipient is RelayRecipient {

    uint last_timestamp;
    uint call_count;
	bytes method_sig;

    uint max_calls_per_hour;
    /**
     * save a valid method signature that we accept.
     * should be initialized from the constructor
     * a method signature can be obtained (as hex) with: web3.sha3("myMethod(uint256").slice(0,8)
     */
    function set_valid_signature(bytes _sig) internal {
        method_sig = _sig;
    }
    /**
     */
    function may_relay(address /*relay*/, address /*from*/, bytes function_call ) public view returns(uint32) {

        //validate this is a method call we accept:
        for ( uint i=0; i<method_sig.length; i++ ) {
            if ( method_sig[i] != function_call[i] )
                return 11;
        }

        if ( block.timestamp - last_timestamp > 3600 ) {
            call_count = 0;
            last_timestamp = block.timestamp;
        }
        //throttle # of calls per hour:
        if ( call_count > max_calls_per_hour ) return 12;
        call_count = call_count+1;
        return 0;
    }

}
