pragma solidity >=0.4.0 <0.6.0;

import "./RelayHub.sol";
import "./RelayRecipient.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract SampleRecipient is RelayRecipient, Ownable {

    mapping (address => bool) public relays_whitelist;

    constructor(RelayHub rhub) public {
        init_relay_hub(rhub);
    }

    function deposit() public payable {
        get_relay_hub().depositFor.value(msg.value)(address(this));
    }

    function withdraw() public onlyOwner {
        uint balance = get_relay_hub().balances(address(this));
        get_relay_hub().withdraw(balance);
        msg.sender.transfer(balance);
    }

    event Reverting(string message);
    function testRevert() public {
        require( address(this) == address(0), "always fail" );
        emit Reverting("if you see this revert failed..." );
    }


    function () external payable {}

    event SampleRecipientEmitted(string message, address real_sender, address msg_sender, address origin);
    function emitMessage(string memory message) public {
        emit SampleRecipientEmitted(message, get_sender(), msg.sender, tx.origin);
    }

    function set_relay(address relay, bool on) public {
        relays_whitelist[relay] = on;
    }

    address public blacklisted;

    function set_blacklisted(address addr) public {
        blacklisted = addr;
    }

    function accept_relayed_call(address relay, address from, bytes memory /*encoded_function*/, uint /*gas_price*/, uint /*transaction_fee*/ ) public view returns(uint32) {
        // The factory accepts relayed transactions from anyone, so we whitelist our own relays to prevent abuse.
        // This protection only makes sense for contracts accepting anonymous calls, and therefore not used by Gatekeeper or Multisig.
        // May be protected by a user_credits map managed by a captcha-protected web app or association with a google account.
        if ( relays_whitelist[relay] ) return 0;
        if (from == blacklisted) return 3;

		return 0;
    }

    event SampleRecipientPostCall(uint used_gas );

    function post_relayed_call(address /*relay*/ , address /*from*/, bytes memory /*encoded_function*/, bool /*success*/, uint used_gas, uint transaction_fee ) public {

        emit SampleRecipientPostCall(used_gas * tx.gasprice * (transaction_fee+100)/100);
    }

}

