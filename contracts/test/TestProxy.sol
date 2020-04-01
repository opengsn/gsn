/* solhint-disable avoid-tx-origin */
pragma solidity ^0.5.16;

import "../BaseRelayRecipient.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract TestProxy is Ownable, BaseRelayRecipient {

    constructor(address forwarder) public {
        trustedForwarder = forwarder;
    }

    function isOwner() public view returns (bool) {
        return getSender() == owner();
    }

    event Test(address getSender, address msg_sender);
    //not a proxy method; just for testing.
    function test() public {
        emit Test(getSender(), msg.sender);
    }

    function execute(address target, bytes calldata func) external onlyOwner {

        //solhint-disable-next-line
        (bool success, bytes memory ret) = target.call(func);
        require(success, string(ret));
    }
}
