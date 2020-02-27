pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../BaseGasSponsor.sol";
import "../BaseRelayRecipient.sol";

// TODO: update this contract and cover it with a test. Currently unusable. Do not use it for reference.
/**
 * Sample User whitelist relay sponsor.
 * Only registered users are allowed to access this contract.
 * Only admins are allowed to add/remove users.
 * (note that neither users nor admins hold any ether)
 */
contract KnownUsersSponsor is BaseGasSponsor, BaseRelayRecipient {

    mapping(address => bool) public users;
    mapping(address => bool) public admins;

    function isUser(address from) public view returns (bool) {
        return users[from];
    }

    function isAdmin(address from) public view returns (bool) {
        return admins[from];
    }

    constructor(IRelayHub _relayHub, address[] memory _initialAdmins) public {
        relayHub = _relayHub;
        for (uint i = 0; i < _initialAdmins.length; i++) {
            admins[_initialAdmins[i]] = true;
        }
    }

    //mark methods accessible only by admins.
    // NOTE: getSender() returns the real sender originating a call, whether it is via a relay
    // or called directly (by a real ethereum account, which pays for the call)
    modifier requireAdmin() {
        require(isAdmin(getSender()));
        _;
    }

    //mark methods accessible only by registered users.
    // NOTE: getSender() returns the real sender originating a call, whether it is via a relay
    // or called directly (by a real ethereum account, which pays for the call)
    modifier requireUser() {
        require(isUser(getSender()));
        _;
    }

    function changeAdmin(address _admin, bool add) public requireAdmin() {
        admins[_admin] = add;
    }

    function changeUser(address _user, bool add) public requireAdmin() {
        users[_user] = add;
    }

    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    view
    returns (uint256, bytes memory) {
        (approvalData, maxPossibleCharge);
        address from = relayRequest.relayData.senderAccount;
        if (isUser(from) || isAdmin(from)) {
            return (0, "");
        }
        return (10, "Not a user");
    }

    function preRelayedCall(bytes calldata context) external returns (bytes32) {
        (context);
        return "";
    }

    function postRelayedCall(bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal) external {
        (context, success, actualCharge, preRetVal);
    }
}
