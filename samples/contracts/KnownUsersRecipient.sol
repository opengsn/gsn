pragma solidity ^0.4.18;

import "../RelayRecipient.sol";

/**
 * Sample User-enabled relay recipient.
 * Only registered users are allowed to access this contract.
 * Only admins are allowed to add/remove users.
 * (note that neither users nor admins hold any ether)
 * A typical DAO contract would use a similar pattern.
 */
contract KnownUsersRecipient is RelayRecipient {

    mapping (address => bool) public users;
    mapping (address => bool) public admins;

    //check if this is a known user to our contract
    function isUser(address from) public view returns (bool) {
        return users[from];
    }

    //check if this is a known admin of this contract.
    function isAdmin(address from) public view returns (bool) {
        return admins[from];
    }

    /**
     * create this KnownUsersRecipient
     * @param _rhub - the relay hub we're connected to.
     */
    constructor(RelayHub _rhub, address[] _initialAdmins) public {
		setRelayHub(_rhub);
        for ( uint i=0; i< _initialAdmins.length; i++ ) {
            admins[_initialAdmins[i]] = true;
        }
    }

    //mark methods accessible only by admins.
    // NOTE: getSender() returns the real sender originating a call, whether it is via a relay
    // or called directly (by a real ethereum account, which pays for the call)
    modifier requireAdmin() { require(isAdmin(getSender())); _; }

    //mark methods accessible only by registered users.
    // NOTE: getSender() returns the real sender originating a call, whether it is via a relay
    // or called directly (by a real ethereum account, which pays for the call)
    modifier requireUser() { require(isUser(getSender())); _; }

    function changeAdmin(address _admin, bool add) public requireAdmin() {
        admins[_admin] = add;
    }

    function changeUser(address _user, bool add) public requireAdmin() {
        users[_user] = add;
    }

    /**
     * validate caller is an admin or a user.
     */
    function acceptRelayedCall(address /*relay*/, address from, bytes /* encodedFunction */) public view returns(uint) {

        if ( isUser(from) || isAdmin(from) ) return 0;

        return 10;
    }

    function postRelayedCall(address /*relay*/, address /*from*/, bytes /*encodedFunction*/, bool /*success*/, uint /*usedGas*/, uint /*transactionFee*/ ) external {
    }

}
