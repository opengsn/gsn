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
contract SingletonWhitelistPaymaster is BasePaymaster {

    struct TargetConfiguration {
        uint256 balance;
        bool useSenderWhitelist;
        bool useTargetWhitelist;
        bool useMethodWhitelist;
        mapping(address => bool) senderWhitelist;
        mapping(address => bool) targetWhitelist;
        mapping(address => mapping(bytes4 => bool)) methodWhitelist;
    }

    event WhitelistedTargets(address indexed dappOwner, uint256 count);
    event WhitelistedSenders(address indexed dappOwner, uint256 count);
    event WhitelistedMethodsForTarget(address indexed dappOwner, address indexed target, uint256 count);

    event Received(address sender, uint256 amount, uint256 balance);
    event SharedConfigChanged(uint256 gasUsedByPost, uint256 paymasterFee);
    event PostRelayedCall(address indexed dappOwner, uint256 gasUseWithoutPost, uint256 totalCharge, uint256 paymasterCharge);

    // TODO: rename, this is dapp configuration!
    mapping(address => TargetConfiguration) public relayingTargets;
    uint256 public gasUsedByPost;
    uint256 public paymasterFee;

    // Custom reentrancy guard as we want to cover 3 methods '_preRelayedCall', 'withdrawBalance' and '_postRelayedCall'
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    function versionPaymaster() external view override virtual returns (string memory){
        return "3.0.0-beta.3+opengsn.singleton-whitelist.ipaymaster";
    }

    function whitelistSenders(address[] memory senders, bool isAllowed) external {
        address dappOwner = msg.sender;
        for (uint i = 0; i < senders.length; i++) {
            relayingTargets[dappOwner].senderWhitelist[senders[i]] = isAllowed;
        }
        emit WhitelistedSenders(dappOwner, senders.length);
    }

    function whitelistTargets(address[] memory targets, bool isAllowed) external {
        address dappOwner = msg.sender;
        for (uint i = 0; i < targets.length; i++) {
            relayingTargets[dappOwner].targetWhitelist[targets[i]] = isAllowed;
        }
        emit WhitelistedTargets(dappOwner, targets.length);
    }

    function whitelistMethodsForTarget(address target, bytes4[] memory methods, bool isAllowed) external {
        address dappOwner = msg.sender;
        for (uint i = 0; i < methods.length; i++) {
            relayingTargets[dappOwner].methodWhitelist[target][methods[i]] = isAllowed;
        }
        emit WhitelistedMethodsForTarget(dappOwner, target, methods.length);
    }

    function setSharedConfiguration(uint256 _gasUsedByPost, uint256 _paymasterFee) external onlyOwner {
        gasUsedByPost = _gasUsedByPost;
        paymasterFee = _paymasterFee;
        emit SharedConfigChanged(gasUsedByPost, paymasterFee);
    }

    function setConfiguration(
        bool _useSenderWhitelist,
        bool _useTargetWhitelist,
        bool _useMethodWhitelist
    ) external {
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
        (signature, approvalData, maxPossibleGas);
        // Any calls to nonReentrant after this point will fail
        _status = _ENTERED;
        address dappOwner = abi.decode(relayRequest.relayData.paymasterData, (address));
        TargetConfiguration storage targetConfiguration = relayingTargets[dappOwner];
        if (!(targetConfiguration.useSenderWhitelist
        || targetConfiguration.useTargetWhitelist
        || targetConfiguration.useMethodWhitelist)
        ) {
            revert("turning off checks is forbidden");
        }

        uint256 maxPossibleCharge = relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData);
        uint256 totalMaxPossibleCharge = addPaymasterFee(maxPossibleCharge);
        require(relayingTargets[dappOwner].balance >= totalMaxPossibleCharge, "insufficient balance for charge");

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
    external
    view
    returns (bool)
    {
        return relayingTargets[dappOwner].senderWhitelist[sender];
    }

    function isTargetWhitelistedForDappOwner(
        address dappOwner,
        address target
    )
    external
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
    external
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
        (success);
        address dappOwner = abi.decode(context, (address));
        uint256 gasUsed = gasUseWithoutPost + gasUsedByPost;
        uint256 actualCharge = relayHub.calculateCharge(gasUsed, relayData);
        uint256 totalCharge = addPaymasterFee(actualCharge);
        uint256 paymasterCharge = totalCharge - actualCharge;
        require(relayingTargets[dappOwner].balance >= totalCharge, "insufficient balance for charge");
        relayingTargets[dappOwner].balance -= totalCharge;
        relayingTargets[owner()].balance += paymasterCharge;
        emit PostRelayedCall(dappOwner, gasUseWithoutPost, totalCharge, paymasterCharge);
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = _NOT_ENTERED;
    }

    // TODO: this is now a shared code. consider extracting to base / library.
    function addPaymasterFee(uint256 charge) public view returns (uint256) {
        return charge * (100 + paymasterFee) / 100;
    }

    receive() external override payable {
        require(address(relayHub) != address(0), "relay hub address not set");
        relayingTargets[msg.sender].balance += msg.value;
        relayHub.depositFor{value : msg.value}(address(this));
        emit Received(msg.sender, msg.value, relayingTargets[msg.sender].balance);
    }

    function withdrawBalance(uint256 amount) external {
        require(_status != _ENTERED, "withdrawBalance reentrant call");
        require(address(relayHub) != address(0), "relay hub address not set");
        require(relayingTargets[msg.sender].balance >= amount, "dapp owner balance insufficient");
        relayingTargets[msg.sender].balance -= amount;
        relayHub.withdraw(payable(msg.sender), amount);
    }
}
