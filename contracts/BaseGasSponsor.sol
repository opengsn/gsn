pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "./interfaces/IGasSponsor.sol";
import "./interfaces/IRelayHub.sol";

/**
 * Abstract base class to be inherited by a concrete Gas Sponsor
 * A subclass must implement:
 *  - acceptRelayedCall
 *  - preRelayedCall
 *  - postRelayedCall
 */
contract BaseGasSponsor is IGasSponsor, Ownable {

    // Gas stipends for acceptRelayedCall, preRelayedCall and postRelayedCall
    uint256 constant private ACCEPT_RELAYED_CALL_MAX_GAS = 50000;
    uint256 constant private PRE_RELAYED_CALL_MAX_GAS = 100000;
    uint256 constant private POST_RELAYED_CALL_MAX_GAS = 110000;

    /// The IRelayHub singleton which is allowed to call us
    IRelayHub internal relayHub;

    function getGasLimitsForSponsorCalls()
    external
    view
    returns (
        GSNTypes.SponsorLimits memory limits
    ){
        return GSNTypes.SponsorLimits(
            ACCEPT_RELAYED_CALL_MAX_GAS,
            PRE_RELAYED_CALL_MAX_GAS,
            POST_RELAYED_CALL_MAX_GAS
        );
    }

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
    function getRelayHubDeposit()
    public
    view
    returns (uint) {
        return relayHub.balanceOf(address(this));
    }

    /// withdraw deposit from relayHub
    function withdrawRelayHubDepositTo(uint amount, address payable target) public onlyOwner {
        relayHub.withdraw(amount, target);
    }
}
