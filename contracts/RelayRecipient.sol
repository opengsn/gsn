pragma solidity >=0.4.0 <0.6.0;

// Contract that implements the relay recipient protocol.  Inherited by Gatekeeper, or any other relay recipient.
//
// The recipient contract is responsible to:
// * pass a trusted IRelayHub singleton to the constructor.
// * Implement acceptRelayedCall, which acts as a whitelist/blacklist of senders.  It is advised that the recipient's owner will be able to update that list to remove abusers.
// * In every function that cares about the sender, use "address sender = getSender()" instead of msg.sender.  It'll return msg.sender for non-relayed transactions, or the real sender in case of relayed transactions.

import "./IRelayRecipient.sol";
import "./IRelayHub.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";

contract RelayRecipient is IRelayRecipient {

    IRelayHub private relayHub; // The IRelayHub singleton which is allowed to call us

    function getHubAddr() public view returns (address) {
        return address(relayHub);
    }

    /**
     * initialize the IRelayHub.
     * contracts usually call this method from the constructor (using a constract IRelayHub, or receiving
     * one in the constructor)
     * This method might also be called by the owner, in order to use a new IRelayHub - since the IRelayHub
     * itself is not an upgradable contract.
     */
    function initRelayHub(IRelayHub _rhub) internal {
        require(relayHub == IRelayHub(0), "initRelayHub: rhub already set");
        setRelayHub(_rhub);
    }

    function setRelayHub(IRelayHub _rhub) internal {
        // Normally called just once, during initRelayHub.
        // Left as a separate internal function, in case a contract wishes to have its own update mechanism for RelayHub.
        relayHub = _rhub;

        //attempt a read method, just to validate the relay is a valid RelayHub contract.
        getRecipientBalance();
    }

    function getRelayHub() internal view returns (IRelayHub) {
        return relayHub;
    }

    /**
     * return the balance of this contract.
     * Note that this method will revert on configuration error (invalid relay address)
     */
    function getRecipientBalance() public view returns (uint) {
        return getRelayHub().balanceOf(address(this));
    }

    function getSenderFromData(address origSender, bytes memory msgData) public view returns (address) {
        address sender = origSender;
        if (origSender == getHubAddr()) {
            // At this point we know that the sender is a trusted IRelayHub, so we trust that the last bytes of msg.data are the verified sender address.
            // extract sender address from the end of msg.data
            sender = LibBytes.readAddress(msgData, msgData.length - 20);
        }
        return sender;
    }

    function getSender() public view returns (address) {
        return getSenderFromData(msg.sender, msg.data);
    }

    function getMessageData() public view returns (bytes memory) {
        bytes memory origMsgData = msg.data;
        if (msg.sender == getHubAddr()) {
            // At this point we know that the sender is a trusted IRelayHub, so we trust that the last bytes of msg.data are the verified sender address.
            // extract original message data from the start of msg.data
            origMsgData = new bytes(msg.data.length - 20);
            for (uint256 i = 0; i < origMsgData.length; i++)
            {
                origMsgData[i] = msg.data[i];
            }
        }
        return origMsgData;
    }
    /*** Note :values below 10 are reserved by canRelay
    *  @param encodedFunction the encoded function call (without any ethereum signature).
    *  @param gasPrice - the gas price for this transaction
    *  @param transactionFee - the relay compensation (in %) for this transaction
    */
    function acceptRelayedCall(address relay, address from, bytes memory encodedFunction, uint gasPrice, uint transactionFee, bytes memory approval) public view returns (uint);
    /** the method is given all parameters of acceptRelayedCall, and also the success/failure status and actual used gas.
    * - usedGas - gas used up to this point. Note that gas calculation (for the purpose of compensation
    */
    function postRelayedCall(address relay, address from, bytes memory encodedFunction, bool success, uint usedGas, uint transactionFee) public;
}

