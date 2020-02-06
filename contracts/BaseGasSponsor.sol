pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "./interfaces/IGasSponsor.sol";
import "./interfaces/IRelayHub.sol";

/**
 * Abstract base class to be inherited by a concrete Gas Sponsor
 * A subclass must implement:
 *  - acceptRelayCall
 *  - preRelayedCall
 *  - postRelayedCall
 */
contract BaseGasSponsor is IGasSponsor, Ownable {

    /// The IRelayHub singleton which is allowed to call us
    IRelayHub internal relayHub;

    function getHubAddr() public view returns (address) {
        return address(relayHub);
    }
    /*
     * modifier to be used by recipients as access control protection for preRelayedCall & postRelayedCall
     */
    modifier relayHubOnly() {
        require(msg.sender == getHubAddr(), "Function can only be called by RelayHub");
        _;
    }

    function setRelayHub(IRelayHub hub) public onlyOwner {
        relayHub = hub;
    }

    /// check current deposit on relay hub.
    // (wanted to name it "getRelayHubDeposit()", but we use the name from IRelayRecipient...
    function getRelayHubDeposit() view public returns (uint)  {
        return relayHub.balanceOf(address(this));
    }

    /// withdraw deposit from relayHub
    function withdrawRelayHubDepositTo(uint amount, address payable target) onlyOwner public {
        relayHub.withdraw(amount, target);
    }
}
