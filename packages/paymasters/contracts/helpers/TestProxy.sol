// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "@opengsn/contracts/src/ERC2771Recipient.sol";

contract TestProxy is ERC2771Recipient, Ownable  {

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

    function _msgSender() internal override(Context, ERC2771Recipient) view returns (address) {
        return ERC2771Recipient._msgSender();
    }

    function _msgData() internal override(Context, ERC2771Recipient) view returns (bytes memory) {
        return ERC2771Recipient._msgData();
    }
}
