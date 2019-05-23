pragma solidity >=0.4.0 <0.6.0;

import "./GsnUtils.sol";
import "./IRelayHub.sol";
import "./RelayRecipient.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract SampleRecipient is RelayRecipient, Ownable {

    mapping (address => bool) public relaysWhitelist;

    constructor(IRelayHub rhub) public {
        initRelayHub(rhub);
    }

    function deposit() public payable {
        getRelayHub().depositFor.value(msg.value)(address(this));
    }

    function withdraw() public onlyOwner {
        uint balance = getRelayHub().balanceOf(address(this));
        getRelayHub().withdraw(balance);
        msg.sender.transfer(balance);
    }

    event Reverting(string message);
    function testRevert() public {
        require( address(this) == address(0), "always fail" );
        emit Reverting("if you see this revert failed..." );
    }


    function () external payable {}

    event SampleRecipientEmitted(string message, address realSender, address msgSender, address origin);
    function emitMessage(string memory message) public {
        emit SampleRecipientEmitted(message, getSender(), msg.sender, tx.origin);
    }

    function setRelay(address relay, bool on) public {
        relaysWhitelist[relay] = on;
    }

    address public blacklisted;

    function setBlacklisted(address addr) public {
        blacklisted = addr;
    }

    function acceptRelayedCall(address relay, address from, bytes memory /*encodedFunction*/, uint /*gasPrice*/, uint /*transactionFee*/ , bytes memory approval) public view returns(uint) {
        // The factory accepts relayed transactions from anyone, so we whitelist our own relays to prevent abuse.
        // This protection only makes sense for contracts accepting anonymous calls, and therefore not used by Gatekeeper or Multisig.
        // May be protected by a user_credits map managed by a captcha-protected web app or association with a google account.
        if ( relaysWhitelist[relay] ) return 0;
        if (from == blacklisted) return 11;
        
        // this is an example of how the dapp can provide an offchain approval to a transaction
        if (approval.length == 65){
            // No owner signature given - proceed as usual (for existing tests)
            return 0;
        }

        // extract owner sig from all approval bytes
        bytes memory ownerSig = LibBytes.slice(approval, 65, 130);
        if (!GsnUtils.checkSig(owner(), keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked("I approve", from)))), ownerSig)) {
            return 12;
        }

		return 0;
    }

    event SampleRecipientPostCall(uint usedGas );

    function postRelayedCall(address /*relay*/ , address /*from*/, bytes memory /*encodedFunction*/, bool /*success*/, uint usedGas, uint transactionFee) public {

        emit SampleRecipientPostCall(usedGas * tx.gasprice * (transactionFee +100)/100);
    }

}

