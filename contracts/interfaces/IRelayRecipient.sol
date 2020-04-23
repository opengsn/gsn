pragma solidity ^0.5.16;

contract IRelayRecipient {
    function getTrustedForwarder() public view returns(address);
}
