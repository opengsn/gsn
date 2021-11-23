// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../BaseRelayRecipient.sol";

contract TestToken is ERC20("Test Token", "TOK"), BaseRelayRecipient {

    function versionRecipient() external override pure returns (string memory){
        return "2.2.3+opengsn.testtoken.irelayrecipient";
    }

    function _msgSender() internal override(Context, BaseRelayRecipient) view returns (address) {
        return BaseRelayRecipient._msgSender();
    }

    function _msgData() internal override(Context, BaseRelayRecipient) view returns (bytes calldata) {
        return BaseRelayRecipient._msgData();
    }

    function setTrustedForwarder(address _forwarder) public {
        _setTrustedForwarder(_forwarder);
    }

    function mint(uint amount) public {
        _mint(msg.sender, amount);
    }

    event UnknownMsgDataReceived(address msg_sender, address _msgSender, bytes msgData);

    fallback() external payable {
        emit UnknownMsgDataReceived(msg.sender, _msgSender(), msg.data);
    }
}
