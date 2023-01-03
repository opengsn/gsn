// solhint-disable not-rely-on-time
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import "./interfaces/IStakeManager.sol";

/**
 * @title The StakeManager implementation
 * @notice An IStakeManager instance that accepts stakes in any ERC-20 token.
 *
 * @notice Single StakeInfo of a single RelayManager can only have one token address assigned to it.
 *
 * @notice It cannot be changed after the first time 'stakeForRelayManager' is called as it is equivalent to withdrawal.
 */
contract StakeManager is IStakeManager, Ownable, ERC165 {
    using SafeERC20 for IERC20;

    string public override versionSM = "3.0.0-beta.3+opengsn.stakemanager.istakemanager";
    uint256 internal immutable maxUnstakeDelay;

    AbandonedRelayServerConfig internal abandonedRelayServerConfig;

    address internal burnAddress;
    uint256 internal immutable creationBlock;

    /// maps relay managers to their stakes
    mapping(address => StakeInfo) public stakes;

    /// @inheritdoc IStakeManager
    function getStakeInfo(address relayManager) external override view returns (StakeInfo memory stakeInfo, bool isSenderAuthorizedHub) {
        bool isHubAuthorized = authorizedHubs[relayManager][msg.sender].removalTime == type(uint256).max;
        return (stakes[relayManager], isHubAuthorized);
    }

    /// @inheritdoc IStakeManager
    function setBurnAddress(address _burnAddress) public override onlyOwner {
        burnAddress = _burnAddress;
        emit BurnAddressSet(burnAddress);
    }

    /// @inheritdoc IStakeManager
    function getBurnAddress() external override view returns (address) {
        return burnAddress;
    }

    /// @inheritdoc IStakeManager
    function setDevAddress(address _devAddress) public override onlyOwner {
        abandonedRelayServerConfig.devAddress = _devAddress;
        emit DevAddressSet(abandonedRelayServerConfig.devAddress);
    }

    /// @inheritdoc IStakeManager
    function getAbandonedRelayServerConfig() external override view returns (AbandonedRelayServerConfig memory) {
        return abandonedRelayServerConfig;
    }

    /// @inheritdoc IStakeManager
    function getMaxUnstakeDelay() external override view returns (uint256) {
        return maxUnstakeDelay;
    }

    /// maps relay managers to a map of addressed of their authorized hubs to the information on that hub
    mapping(address => mapping(address => RelayHubInfo)) public authorizedHubs;

    constructor(
        uint256 _maxUnstakeDelay,
        uint256 _abandonmentDelay,
        uint256 _escheatmentDelay,
        address _burnAddress,
        address _devAddress
    ) {
        require(_burnAddress != address(0), "transfers to address(0) may fail");
        setBurnAddress(_burnAddress);
        setDevAddress(_devAddress);
        creationBlock = block.number;
        maxUnstakeDelay = _maxUnstakeDelay;
        abandonedRelayServerConfig.abandonmentDelay = _abandonmentDelay;
        abandonedRelayServerConfig.escheatmentDelay = _escheatmentDelay;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IStakeManager).interfaceId ||
        super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IStakeManager
    function getCreationBlock() external override view returns (uint256){
        return creationBlock;
    }

    /// @inheritdoc IStakeManager
    function setRelayManagerOwner(address owner) external override {
        require(owner != address(0), "invalid owner");
        require(stakes[msg.sender].owner == address(0), "already owned");
        stakes[msg.sender].owner = owner;
        emit OwnerSet(msg.sender, owner);
    }

    /// @inheritdoc IStakeManager
    function stakeForRelayManager(IERC20 token, address relayManager, uint256 unstakeDelay, uint256 amount) external override relayOwnerOnly(relayManager) {
        require(unstakeDelay >= stakes[relayManager].unstakeDelay, "unstakeDelay cannot be decreased");
        require(unstakeDelay <= maxUnstakeDelay, "unstakeDelay too big");
        require(token != IERC20(address(0)), "must specify stake token address");
        require(
            stakes[relayManager].token == IERC20(address(0)) ||
            stakes[relayManager].token == token,
            "stake token address is incorrect");
        token.safeTransferFrom(msg.sender, address(this), amount);
        stakes[relayManager].token = token;
        stakes[relayManager].stake += amount;
        stakes[relayManager].unstakeDelay = unstakeDelay;
        emit StakeAdded(relayManager, stakes[relayManager].owner, stakes[relayManager].token, stakes[relayManager].stake, stakes[relayManager].unstakeDelay);
    }

    /// @inheritdoc IStakeManager
    function unlockStake(address relayManager) external override relayOwnerOnly(relayManager) {
        StakeInfo storage info = stakes[relayManager];
        require(info.withdrawTime == 0, "already pending");
        info.withdrawTime = block.timestamp + info.unstakeDelay;
        emit StakeUnlocked(relayManager, msg.sender, info.withdrawTime);
    }

    /// @inheritdoc IStakeManager
    function withdrawStake(address relayManager) external override relayOwnerOnly(relayManager) {
        StakeInfo storage info = stakes[relayManager];
        require(info.withdrawTime > 0, "Withdrawal is not scheduled");
        require(info.withdrawTime <= block.timestamp, "Withdrawal is not due");
        uint256 amount = info.stake;
        info.stake = 0;
        info.withdrawTime = 0;
        info.token.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(relayManager, msg.sender, info.token, amount);
    }

    /// @notice Prevents any address other than a registered Relay Owner from calling this method.
    modifier relayOwnerOnly (address relayManager) {
        StakeInfo storage info = stakes[relayManager];
        require(info.owner == msg.sender, "not owner");
        _;
    }

    /// @notice Prevents any address other than a registered Relay Manager from calling this method.
    modifier managerOnly () {
        StakeInfo storage info = stakes[msg.sender];
        require(info.owner != address(0), "not manager");
        _;
    }

    /// @inheritdoc IStakeManager
    function authorizeHubByOwner(address relayManager, address relayHub) external relayOwnerOnly(relayManager) override {
        _authorizeHub(relayManager, relayHub);
    }

    /// @inheritdoc IStakeManager
    function authorizeHubByManager(address relayHub) external managerOnly override {
        _authorizeHub(msg.sender, relayHub);
    }

    function _authorizeHub(address relayManager, address relayHub) internal {
        authorizedHubs[relayManager][relayHub].removalTime = type(uint256).max;
        emit HubAuthorized(relayManager, relayHub);
    }

    /// @inheritdoc IStakeManager
    function unauthorizeHubByOwner(address relayManager, address relayHub) external override relayOwnerOnly(relayManager) {
        _unauthorizeHub(relayManager, relayHub);
    }

    /// @inheritdoc IStakeManager
    function unauthorizeHubByManager(address relayHub) external override managerOnly {
        _unauthorizeHub(msg.sender, relayHub);
    }

    function _unauthorizeHub(address relayManager, address relayHub) internal {
        RelayHubInfo storage hubInfo = authorizedHubs[relayManager][relayHub];
        require(hubInfo.removalTime == type(uint256).max, "hub not authorized");
        hubInfo.removalTime = block.timestamp + stakes[relayManager].unstakeDelay;
        emit HubUnauthorized(relayManager, relayHub, hubInfo.removalTime);
    }

    /// @inheritdoc IStakeManager
    function penalizeRelayManager(address relayManager, address beneficiary, uint256 amount) external override {
        uint256 removalTime = authorizedHubs[relayManager][msg.sender].removalTime;
        require(removalTime != 0, "hub not authorized");
        require(removalTime > block.timestamp, "hub authorization expired");

        // Half of the stake will be burned (sent to address 0)
        require(stakes[relayManager].stake >= amount, "penalty exceeds stake");
        stakes[relayManager].stake =stakes[relayManager].stake - amount;

        uint256 toBurn = amount / 2;
        uint256 reward = amount - toBurn;

        // Stake ERC-20 token is burned and transferred
        stakes[relayManager].token.safeTransfer(burnAddress, toBurn);
        stakes[relayManager].token.safeTransfer(beneficiary, reward);
        emit StakePenalized(relayManager, beneficiary, stakes[relayManager].token, reward);
    }

    /// @inheritdoc IStakeManager
    function isRelayEscheatable(address relayManager) public view override returns (bool) {
        IStakeManager.StakeInfo memory stakeInfo = stakes[relayManager];
        return stakeInfo.abandonedTime != 0 && stakeInfo.abandonedTime + abandonedRelayServerConfig.escheatmentDelay < block.timestamp;
    }

    /// @inheritdoc IStakeManager
    function markRelayAbandoned(address relayManager) external override onlyOwner {
        StakeInfo storage info = stakes[relayManager];
        require(info.stake > 0, "relay manager not staked");
        require(info.abandonedTime == 0, "relay manager already abandoned");
        require(info.keepaliveTime + abandonedRelayServerConfig.abandonmentDelay < block.timestamp, "relay manager was alive recently");
        info.abandonedTime = block.timestamp;
        emit RelayServerAbandoned(relayManager, info.abandonedTime);
    }

    /// @inheritdoc IStakeManager
    function escheatAbandonedRelayStake(address relayManager) external override onlyOwner {
        StakeInfo storage info = stakes[relayManager];
        require(isRelayEscheatable(relayManager), "relay server not escheatable yet");
        uint256 amount = info.stake;
        info.stake = 0;
        info.withdrawTime = 0;
        info.token.safeTransfer(abandonedRelayServerConfig.devAddress, amount);
        emit AbandonedRelayManagerStakeEscheated(relayManager, msg.sender, info.token, amount);
    }

    /// @inheritdoc IStakeManager
    function updateRelayKeepaliveTime(address relayManager) external override {
        StakeInfo storage info = stakes[relayManager];
        bool isHubAuthorized = authorizedHubs[relayManager][msg.sender].removalTime == type(uint256).max;
        bool isRelayOwner = info.owner == msg.sender;
        require(isHubAuthorized || isRelayOwner, "must be called by owner or hub");
        info.abandonedTime = 0;
        info.keepaliveTime = block.timestamp;
        emit RelayServerKeepalive(relayManager, info.keepaliveTime);
    }
}
