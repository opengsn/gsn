//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

// #if ENABLE_CONSOLE_LOG
import "hardhat/console.sol";
// #endif

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";

/// A sample paymaster that has whitelists for senders, targets and methods.
/// - if at least one sender is whitelisted, then ONLY whitelisted senders are allowed.
/// - if at least one target is whitelisted, then ONLY whitelisted targets are allowed.
contract SingletonWhitelistPaymaster is BasePaymaster, ReentrancyGuard {

    struct TargetConfiguration {
        uint256 balance;
        bool useSenderWhitelist;
        bool useTargetWhitelist;
        bool useMethodWhitelist;
        mapping(address => bool) senderWhitelist;
        mapping(address => bool) targetWhitelist;
        mapping(address => mapping(bytes4 => bool)) methodWhitelist;
    }

    event WhitelistedTargets(uint256 count);
    event WhitelistedSenders(uint256 count);
    event WhitelistedMethodsForTarget(address indexed target, uint256 count);
    event Received(address sender, uint256 amount, uint256 balance);

    // TODO: rename, this is dapp configuration!
    mapping(address => TargetConfiguration) public relayingTargets;
    uint256 public gasUsedByPost;
    uint256 public paymasterFee;

    function versionPaymaster() external view override virtual returns (string memory){
        return "3.0.0-beta.3+opengsn.singleton-whitelist.ipaymaster";
    }

    function whitelistSenders(address[] memory senders, bool isAllowed) public {
        address dappOwner = msg.sender;
        for (uint i = 0; i < senders.length; i++) {
            relayingTargets[dappOwner].senderWhitelist[senders[i]] = isAllowed;
        }
        emit WhitelistedSenders(senders.length);
    }

    function whitelistTargets(address[] memory targets, bool isAllowed) public {
        address dappOwner = msg.sender;
        for (uint i = 0; i < targets.length; i++) {
            relayingTargets[dappOwner].targetWhitelist[targets[i]] = isAllowed;
        }
        emit WhitelistedTargets(targets.length);
    }

    function whitelistMethodsForTarget(address target, bytes4[] memory methods, bool isAllowed) public {
        address dappOwner = msg.sender;
        for (uint i = 0; i < methods.length; i++) {
            relayingTargets[dappOwner].methodWhitelist[target][methods[i]] = isAllowed;
        }
        emit WhitelistedMethodsForTarget(target, methods.length);
    }

    function setConfiguration(
        bool _useSenderWhitelist,
        bool _useTargetWhitelist,
        bool _useMethodWhitelist
    ) public {
        if (!(_useSenderWhitelist || _useTargetWhitelist || _useMethodWhitelist)) {
            revert('turning off checks is forbidden');
        }
        relayingTargets[msg.sender].useSenderWhitelist = _useSenderWhitelist;
        relayingTargets[msg.sender].useTargetWhitelist = _useTargetWhitelist;
        relayingTargets[msg.sender].useMethodWhitelist = _useMethodWhitelist;
    }

    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {
        require(relayRequest.relayData.paymasterData.length == 32, "paymasterData: invalid length");
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
        address dappOwner = abi.decode(relayRequest.relayData.paymasterData, (address));
        TargetConfiguration storage targetConfiguration = relayingTargets[dappOwner];
        if (!(targetConfiguration.useSenderWhitelist
        || targetConfiguration.useTargetWhitelist
        || targetConfiguration.useMethodWhitelist)
        ) {
            revert('turning off checks is forbidden');
        }

        uint256 maxPossibleCharge = relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData);
        require(relayingTargets[dappOwner].balance >= maxPossibleCharge, "insufficient balance for charge");

        if (targetConfiguration.useSenderWhitelist) {
            address sender = relayRequest.request.from;
            require(targetConfiguration.senderWhitelist[sender], "sender not whitelisted");
        }
        if (targetConfiguration.useTargetWhitelist) {
            address target = relayRequest.request.to;
            require(targetConfiguration.targetWhitelist[target], "target not whitelisted");
        }
        if (targetConfiguration.useMethodWhitelist) {
            address target = relayRequest.request.to;
            bytes4 method = GsnUtils.getMethodSig(relayRequest.request.data);
            require(targetConfiguration.methodWhitelist[target][method], "method not whitelisted");
        }

        return (relayRequest.relayData.paymasterData, true);
    }

    function isSenderWhitelistedForDappOwner(
        address dappOwner,
        address sender
    )
    public
    view
    returns (bool)
    {
        return relayingTargets[dappOwner].senderWhitelist[sender];
    }

    function isTargetWhitelistedForDappOwner(
        address dappOwner,
        address target
    )
    public
    view
    returns (bool)
    {
        return relayingTargets[dappOwner].targetWhitelist[target];
    }

    function isMethodWhitelistedForTargetAndDappOwner(
        address dappOwner,
        address target,
        bytes4 method
    )
    public
    view
    returns (bool)
    {
        return relayingTargets[dappOwner].methodWhitelist[target][method];
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
        // TODO: do I need to pre-charge/refund? the owner can 'withdraw' in the meta-tx flow if is contract?
        (context, success, relayData);
        uint256 gasUsed = gasUseWithoutPost + gasUsedByPost;
        uint256 charge = relayHub.calculateCharge(gasUsed, relayData);
        address dappOwner = abi.decode(context, (address));
        require(relayingTargets[dappOwner].balance >= charge, "insufficient balance for charge");
        relayingTargets[dappOwner].balance -= charge;
    }

    receive() external override payable {
        require(address(relayHub) != address(0), "relay hub address not set");
        relayingTargets[msg.sender].balance += msg.value;
        relayHub.depositFor{value:msg.value}(address(this));
        // #if ENABLE_CONSOLE_LOG
        console.log("Received: %s %s %s:", msg.sender, msg.value, relayingTargets[msg.sender].balance);
        // #endif
        emit Received(msg.sender, msg.value, relayingTargets[msg.sender].balance);
    }

    function withdrawBalance(uint256 amount) public nonReentrant {
        // TODO: accounting
        relayHub.withdraw(payable(msg.sender), amount);
    }
}
