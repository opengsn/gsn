//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "./AcceptEverythingPaymaster.sol";

/// A sample paymaster that has whitelists for senders, targets and methods.
/// - if at least one sender is whitelisted, then ONLY whitelisted senders are allowed.
/// - if at least one target is whitelisted, then ONLY whitelisted targets are allowed.
contract WhitelistPaymaster is AcceptEverythingPaymaster {

    bool public useSenderWhitelist;
    bool public useTargetWhitelist;
    bool public useMethodWhitelist;
    mapping (address=>bool) public senderWhitelist;
    mapping (address=>bool) public targetWhitelist;
    mapping (bytes4=>bool) public methodWhitelist;

    function whitelistSender(address sender, bool isAllowed) public onlyOwner {
        senderWhitelist[sender] = isAllowed;
    }

    function whitelistTarget(address target, bool isAllowed) public onlyOwner {
        targetWhitelist[target] = isAllowed;
    }

    function whitelistMethod(bytes4 method, bool isAllowed) public onlyOwner {
        methodWhitelist[method] = isAllowed;
    }

    function setConfiguration(
        bool _useSenderWhitelist,
        bool _useTargetWhitelist,
        bool _useMethodWhitelist
    ) public onlyOwner {
        useSenderWhitelist = _useSenderWhitelist;
        useTargetWhitelist = _useTargetWhitelist;
        useMethodWhitelist = _useMethodWhitelist;
    }

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    virtual
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (signature, maxPossibleGas);
        require(approvalData.length == 0, "approvalData: invalid length");
        require(relayRequest.relayData.paymasterData.length == 0, "paymasterData: invalid length");

        if (useSenderWhitelist) {
            require(senderWhitelist[relayRequest.request.from], "sender not whitelisted");
        }

        if (useTargetWhitelist) {
            require(targetWhitelist[relayRequest.request.to], "target not whitelisted");
        }

        if (useMethodWhitelist) {
            bytes4 method = GsnUtils.getMethodSig(relayRequest.request.data);
            require(methodWhitelist[method], "method not whitelisted");
        }
        return ("", false);
    }
}
