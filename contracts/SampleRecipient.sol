pragma solidity ^0.5.5;

import "./GsnUtils.sol";
import "./IRelayHub.sol";
import "./RelayRecipient.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

contract SampleRecipient is RelayRecipient, Ownable {
    using ECDSA for bytes32;

    mapping (address => bool) public relaysWhitelist;

    // Testing RelayHub: withdrawing a recipient's deposit is prohibited during relayCall
    bool public withdrawDuringPreRelayedCall;
    bool public withdrawDuringRelayedCall;
    bool public withdrawDuringPostRelayedCall;

    // Testing RelayHub: Looping to spend more than acceptRelayedCallMaxGas (50000)
    bool public overspendAcceptGas;

    bool public revertPostRelayCall;
    bool public revertPreRelayCall;

    bool public rejectAcceptRelayCall;

    bool public returnInvalidErrorCode;

    bool public storeAcceptData;

    constructor(IRelayHub rhub) public {
        setRelayHub(rhub);
    }

    function deposit() public payable {
        getRelayHub().depositFor.value(msg.value)(address(this));
    }

    function withdraw() public onlyOwner {
        uint256 balance = withdrawAllBalance();
        msg.sender.transfer(balance);
    }

    event Reverting(string message);

    function testRevert() public {
        require(address(this) == address(0), "always fail");
        emit Reverting("if you see this revert failed...");
    }

    function setWithdrawDuringPreRelayedCall(bool val) public {
        withdrawDuringPreRelayedCall = val;
    }

    function setWithdrawDuringRelayedCall(bool val) public {
        withdrawDuringRelayedCall = val;
    }

    function setWithdrawDuringPostRelayedCall(bool val) public {
        withdrawDuringPostRelayedCall = val;
    }

    function setReturnInvalidErrorCode(bool val) public {
        returnInvalidErrorCode = val;
    }

    function setOverspendAcceptGas(bool val) public{
        overspendAcceptGas = val;
    }

    function setRevertPreRelayCall(bool val) public{
        revertPreRelayCall = val;
    }

    function setRevertPostRelayCall(bool val) public{
        revertPostRelayCall = val;
    }

    function setRejectAcceptRelayCall(bool val) public{
        rejectAcceptRelayCall = val;
    }

    function setStoreAcceptData(bool val) public {
        storeAcceptData = val;
    }

    function() external payable {}

    event SampleRecipientEmitted(string message, address realSender, address msgSender, address origin);

    function emitMessage(string memory message) public {
        if (withdrawDuringRelayedCall) {
            withdrawAllBalance();
        }

        emit SampleRecipientEmitted(message, getSender(), msg.sender, tx.origin);
    }

    function dontEmitMessage(string memory message) public {}

    function emitMessageNoParams() public {
        emit SampleRecipientEmitted("Method with no parameters", getSender(), msg.sender, tx.origin);
    }

    function setRelay(address relay, bool on) public {
        relaysWhitelist[relay] = on;
    }

    address public blacklisted;

    function setBlacklisted(address addr) public {
        blacklisted = addr;
    }

    function acceptRelayedCall(address relay, address from, bytes calldata encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes calldata approvalData, uint256 maxPossibleCharge) external view returns (uint256, bytes memory) {
        // The factory accepts relayed transactions from anyone, so we whitelist our own relays to prevent abuse.
        // This protection only makes sense for contracts accepting anonymous calls, and therefore not used by Gatekeeper or Multisig.
        // May be protected by a user_credits map managed by a captcha-protected web app or association with a google account.

        if (overspendAcceptGas){
            bool success;
            bytes memory ret = new bytes(32);
            (success,ret) = address(this).staticcall(abi.encodeWithSelector(this.infiniteLoop.selector));
        }

        if ( returnInvalidErrorCode ) return (10, "");

        if ( relaysWhitelist[relay] ) return (0, "");
        if (from == blacklisted) return (11, "");
        if ( rejectAcceptRelayCall ) return (12, "");

        // this is an example of how the dapp can provide an offchain signature to a transaction
        if (approvalData.length > 0) {
            // extract owner sig from all signature bytes
            if (keccak256(abi.encodePacked("I approve", from)).toEthSignedMessageHash().recover(approvalData) != owner()) {
                return (13, "test: not approved");
            }
        }

        if (storeAcceptData) {
            return (0, abi.encode(relay, from, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approvalData, maxPossibleCharge));
        } else {
            return (0, "");
        }
    }

    function infiniteLoop() pure external{
        uint i = 0;
        while (true) {
            i++;
        }
    }

    event SampleRecipientPreCall();
    event SampleRecipientPreCallWithValues(address relay, address from, bytes encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes approvalData, uint256 maxPossibleCharge);

    function preRelayedCall(bytes calldata context) relayHubOnly external returns (bytes32) {
        if (withdrawDuringPreRelayedCall) {
            withdrawAllBalance();
        }

        emit SampleRecipientPreCall();

        if (storeAcceptData) {
            (address relay, address from, bytes memory encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes memory approvalData, uint256 maxPossibleCharge) =
                abi.decode(context, (address, address, bytes, uint256, uint256, uint256, uint256, bytes, uint256));
            emit SampleRecipientPreCallWithValues(relay, from, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approvalData, maxPossibleCharge);
        }

        if (revertPreRelayCall){
            revert("You asked me to revert, remember?");
        }
        return bytes32(uint(123456));
    }

    event SampleRecipientPostCall(bool success, uint actualCharge, bytes32 preRetVal);
    event SampleRecipientPostCallWithValues(address relay, address from, bytes encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes approvalData, uint256 maxPossibleCharge);

    function postRelayedCall(bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal) relayHubOnly external {
        if (withdrawDuringPostRelayedCall) {
            withdrawAllBalance();
        }

        if (storeAcceptData) {
            (address relay, address from, bytes memory encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes memory approvalData, uint256 maxPossibleCharge) =
                abi.decode(context, (address, address, bytes, uint256, uint256, uint256, uint256, bytes, uint256));
            emit SampleRecipientPostCallWithValues(relay, from, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approvalData, maxPossibleCharge);
        }

        emit SampleRecipientPostCall(success, actualCharge, preRetVal);

        if (revertPostRelayCall){
            revert("You asked me to revert, remember?");
        }
    }

    function withdrawAllBalance() private returns (uint256) {
        uint256 balance = getRelayHub().balanceOf(address(this));
        getRelayHub().withdraw(balance, address(this));
        return balance;
    }
}

