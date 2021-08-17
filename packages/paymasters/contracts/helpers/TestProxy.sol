// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "@opengsn/contracts/src/BaseRelayRecipient.sol";

contract TestProxy is BaseRelayRecipient, Ownable  {

    string public override versionRecipient = "2.0.0-beta.1+opengsn.testproxy.irelayrecipient";

    constructor(address forwarder) {
        _setTrustedForwarder(forwarder);
    }

    function isOwner() public view returns (bool) {
        return _msgSender() == owner();
    }

    event Test(address _msgSender, address msgSender);
    //not a proxy method; just for testing.
    function test() public {
        emit Test(_msgSender(), msg.sender);
    }

    function execute(address target, bytes calldata func) external onlyOwner {

        //solhint-disable-next-line
        (bool success, bytes memory ret) = target.call(func);
        require(success, string(ret));
    }

    function _msgSender() internal override(Context, BaseRelayRecipient) view returns (address) {
        return BaseRelayRecipient._msgSender();
    }

    function _msgData() internal override(Context, BaseRelayRecipient) view returns (bytes memory) {
        return BaseRelayRecipient._msgData();
    }
}
