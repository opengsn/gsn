//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/BasePaymaster.sol";

/**
 * This Paymaster allows the dapp owners to maintain a simple set of rules on-chain for their GSN integrations.
 * Supports enabling specified target contracts (Recipients), senders and methods (per target) to be subsidized.
 * Unlike 'VerifyingPaymaster' doesn't require any server-side code but also does not provide any additional protection.
 */
contract SingletonWhitelistPaymaster is BasePaymaster {

    struct DappInformation {
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

    event Received(address dappOwner, uint256 amount, uint256 balance);
    event Withdrawn(address dappOwner, uint256 amount, uint256 balance);
    event AdminOverrideWithdrawn(address destination, uint256 amount);
    event SharedConfigChanged(uint256 gasUsedByPost, uint256 paymasterFee);
    event DappConfigChanged(address indexed dappOwner, bool useSenderWhitelist, bool useTargetWhitelist, bool useMethodWhitelist);
    event PostRelayedCall(address indexed dappOwner, uint256 gasUseWithoutPost, uint256 totalCharge, uint256 paymasterCharge);

    mapping(address => DappInformation) public registeredDapps;
    uint256 public gasUsedByPost;
    uint256 public paymasterFee;

    // Custom reentrancy guard as we want to cover 3 methods: 'preRelayedCall', 'withdrawBalance' and 'postRelayedCall'
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private status = NOT_ENTERED;

    function versionPaymaster() external view override virtual returns (string memory){
        return "3.0.0-beta.3+opengsn.singleton-whitelist.ipaymaster";
    }

    function whitelistSenders(address[] memory senders, bool isAllowed) external {
        address dappOwner = msg.sender;
        for (uint i = 0; i < senders.length; i++) {
            registeredDapps[dappOwner].senderWhitelist[senders[i]] = isAllowed;
        }
        emit WhitelistedSenders(dappOwner, senders.length);
    }

    function whitelistTargets(address[] memory targets, bool isAllowed) external {
        address dappOwner = msg.sender;
        for (uint i = 0; i < targets.length; i++) {
            registeredDapps[dappOwner].targetWhitelist[targets[i]] = isAllowed;
        }
        emit WhitelistedTargets(dappOwner, targets.length);
    }

    function whitelistMethodsForTarget(address target, bytes4[] memory methods, bool isAllowed) external {
        address dappOwner = msg.sender;
        for (uint i = 0; i < methods.length; i++) {
            registeredDapps[dappOwner].methodWhitelist[target][methods[i]] = isAllowed;
        }
        emit WhitelistedMethodsForTarget(dappOwner, target, methods.length);
    }

    function setSharedConfiguration(uint256 _gasUsedByPost, uint256 _paymasterFee) external onlyOwner {
        gasUsedByPost = _gasUsedByPost;
        paymasterFee = _paymasterFee;
        emit SharedConfigChanged(gasUsedByPost, paymasterFee);
    }

    function setDappConfiguration(
        bool _useSenderWhitelist,
        bool _useTargetWhitelist,
        bool _useMethodWhitelist
    ) external {
        DappInformation storage dappInfo = registeredDapps[msg.sender];
        dappInfo.useSenderWhitelist = _useSenderWhitelist;
        dappInfo.useTargetWhitelist = _useTargetWhitelist;
        dappInfo.useMethodWhitelist = _useMethodWhitelist;
        emit DappConfigChanged(msg.sender, _useSenderWhitelist, _useTargetWhitelist, _useMethodWhitelist);
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
        status = ENTERED;
        address dappOwner = abi.decode(relayRequest.relayData.paymasterData, (address));
        DappInformation storage targetConfiguration = registeredDapps[dappOwner];
        if (!(targetConfiguration.useSenderWhitelist
        || targetConfiguration.useTargetWhitelist
        || targetConfiguration.useMethodWhitelist)
        ) {
            revert("turning off checks is forbidden");
        }

        uint256 maxPossibleCharge = relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData);
        uint256 totalMaxPossibleCharge = addPaymasterFee(maxPossibleCharge);
        require(registeredDapps[dappOwner].balance >= totalMaxPossibleCharge, "insufficient balance for charge");

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
        return registeredDapps[dappOwner].senderWhitelist[sender];
    }

    function isTargetWhitelistedForDappOwner(
        address dappOwner,
        address target
    )
    external
    view
    returns (bool)
    {
        return registeredDapps[dappOwner].targetWhitelist[target];
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
        return registeredDapps[dappOwner].methodWhitelist[target][method];
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
        status = NOT_ENTERED;
        address dappOwner = abi.decode(context, (address));
        uint256 gasUsed = gasUseWithoutPost + gasUsedByPost;
        uint256 actualCharge = relayHub.calculateCharge(gasUsed, relayData);
        uint256 totalCharge = addPaymasterFee(actualCharge);
        uint256 paymasterCharge = totalCharge - actualCharge;
        require(registeredDapps[dappOwner].balance >= totalCharge, "insufficient balance for charge");
        registeredDapps[dappOwner].balance -= totalCharge;
        registeredDapps[owner()].balance += paymasterCharge;
        emit PostRelayedCall(dappOwner, gasUseWithoutPost, totalCharge, paymasterCharge);
    }

    // TODO: this is now a shared code. consider extracting to base / library.
    function addPaymasterFee(uint256 charge) public view returns (uint256) {
        return charge * (100 + paymasterFee) / 100;
    }

    receive() external override payable {
        require(address(relayHub) != address(0), "relay hub address not set");
        relayHub.depositFor{value : msg.value}(address(this));
        registeredDapps[msg.sender].balance += msg.value;
        emit Received(msg.sender, msg.value, registeredDapps[msg.sender].balance);
    }

    function withdrawBalance(uint256 amount) external {
        require(status != ENTERED, "withdrawBalance reentrant call");
        require(address(relayHub) != address(0), "relay hub address not set");
        require(registeredDapps[msg.sender].balance >= amount, "dapp owner balance insufficient");
        registeredDapps[msg.sender].balance -= amount;
        relayHub.withdraw(payable(msg.sender), amount);
        emit Withdrawn(msg.sender, amount, registeredDapps[msg.sender].balance);
    }

    /// @notice Allows the 'owner' of this Paymaster to extract funds from the RelayHub overriding the depositors.
    /// @notice This is necessary in case there is a security vulnerability discovered.
    /// @notice If 'totalCharge' calculation diverges from the RelayHub it would lead to funds being stuck as well.
    function adminOverrideWithdraw(address destination, uint256 amount) external onlyOwner {
        relayHub.withdraw(payable(destination), amount);
        emit AdminOverrideWithdrawn(destination, amount);
    }
}
