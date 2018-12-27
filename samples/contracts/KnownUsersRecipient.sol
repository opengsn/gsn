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
    constructor(RelayHub _rhub, address[] _initial_admins) public {
		init_relay_hub(_rhub);
        for ( uint i=0; i<_initial_admins.length; i++ ) {
            admins[_initial_admins[i]] = true;
        }
    }

    //mark methods accessible only by admins.
    // NOTE: get_sender() returns the real sender originating a call, whether it is via a relay
    // or called directly (by a real ethereum account, which pays for the call)
    modifier requireAdmin() { require(isAdmin(get_sender())); _; }

    //mark methods accessible only by registered users.
    // NOTE: get_sender() returns the real sender originating a call, whether it is via a relay
    // or called directly (by a real ethereum account, which pays for the call)
    modifier requireUser() { require(isUser(get_sender())); _; }

    function change_admin(address _admin, bool add) public requireAdmin() {
        admins[_admin] = add;
    }

    function change_user(address _user, bool add) public requireAdmin() {
        users[_user] = add;
    }

    /**
     * validate caller is an admin or a user.
     */
    function accept_relayed_call(address /*relay*/, address from, bytes /* encoded_function */) public view returns(uint32) {

        if ( isUser(from) || isAdmin(from) ) return 0;

        return 10;
    }

}
