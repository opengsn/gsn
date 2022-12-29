//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/BasePaymaster.sol";

/// A sample paymaster that has whitelists for senders, targets and methods.
/// - if at least one sender is whitelisted, then ONLY whitelisted senders are allowed.
/// - if at least one target is whitelisted, then ONLY whitelisted targets are allowed.
contract WhitelistPaymaster is BasePaymaster {

    bool public useSenderWhitelist;
    bool public useTargetWhitelist;
    bool public useMethodWhitelist;
    bool public useRejectOnRecipientRevert;
    mapping(address => bool) public senderWhitelist;
    mapping(address => bool) public targetWhitelist;
    mapping(address => mapping(bytes4 => bool)) public methodWhitelist;

    function versionPaymaster() external view override virtual returns (string memory){
        return "3.0.0-beta.3+opengsn.whitelist.ipaymaster";
    }

    function whitelistSender(address sender, bool isAllowed) public onlyOwner {
        senderWhitelist[sender] = isAllowed;
    }

    function whitelistTarget(address target, bool isAllowed) public onlyOwner {
        targetWhitelist[target] = isAllowed;
    }

    function whitelistMethod(address target, bytes4 method, bool isAllowed) public onlyOwner {
        methodWhitelist[target][method] = isAllowed;
    }

    function setConfiguration(
        bool _useSenderWhitelist,
        bool _useTargetWhitelist,
        bool _useMethodWhitelist,
        bool _useRejectOnRecipientRevert
    ) public onlyOwner {
        useSenderWhitelist = _useSenderWhitelist;
        useTargetWhitelist = _useTargetWhitelist;
        useMethodWhitelist = _useMethodWhitelist;
        useRejectOnRecipientRevert = _useRejectOnRecipientRevert;
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
            address sender = relayRequest.request.from;
            require(senderWhitelist[sender], "sender not whitelisted");
        }

        if (useTargetWhitelist) {
            address target = relayRequest.request.to;
            require(targetWhitelist[target], "target not whitelisted");
        }

        if (useMethodWhitelist) {
            address target = relayRequest.request.to;
            bytes4 method = GsnUtils.getMethodSig(relayRequest.request.data);
            require(methodWhitelist[target][method], "method not whitelisted");
        }

        return ("", useRejectOnRecipientRevert);
    }

    function _postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal
    override
    virtual {
        (context, success, gasUseWithoutPost, relayData);
    }
}
