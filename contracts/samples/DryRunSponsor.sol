pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../BaseGasSponsor.sol";
import "../BaseRelayRecipient.sol";

/**
 * Dry-run the target method as an indicator whether to accept it or not.
 * This sponsor won't accept target method that fails.
 * It also verifies the target contract is in a given whitelist.
 */
contract DryRunSponsor is BaseGasSponsor, BaseRelayRecipient {

    mapping(address => bool) public recipients;
    mapping(address => bool) public admins;

    constructor(IRelayHub _relayHub) public {
        relayHub = _relayHub;
    }

    function addRecipient(address recipient, bool add) public onlyOwner() {
        recipients[recipient] = add;
    }

    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    )
    external
    returns (uint256, bytes memory) {
        (approvalData, maxPossibleCharge);
        if ( !recipients[relayRequest.target] ) {
            return ( 98, "unknown recipient");
        }
        (bool success, string memory ret ) = relayHub.dryRun( 
                relayRequest.relayData.senderAccount,
                relayRequest.target,
                relayRequest.encodedFunction,
                relayRequest.gasData.gasLimit
            );
        if ( !success )
            return (99, bytes(ret));

        return (0,'');
    }

    function preRelayedCall(bytes calldata context) external returns (bytes32) {
        (this, context);
        return "";
    }

    function postRelayedCall(bytes calldata context, bool success, uint actualCharge, bytes32 preRetVal) view external {
        (this, context, success, actualCharge, preRetVal);
    }
}
