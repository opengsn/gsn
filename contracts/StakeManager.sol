pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./interfaces/IRelayHub.sol";

contract StakeManager {

    /// Emitted when a stake or unstakeDelay are initialized or increased
    event StakeAdded(
        address indexed registree,
        address indexed owner,
        uint256 stake,
        uint256 unstakeDelay
    );

    /// Emitted once a stake is scheduled for withdrawal
    event StakeUnlocked(
        address indexed registree,
        address indexed owner,
        uint256 withdrawBlock
    );

    /// Emitted when owner withdraws registree funds
    event StakeWithdrawn(
        address indexed registree,
        address indexed owner,
        uint256 amount
    );

    /// Emitted when an authorized Relay Hub penalizes a registree
    event StakePenalized(
        address indexed registree,
        address indexed beneficiary,
        uint256 reward
    );

    event HubAuthorized(
        address indexed registree,
        address indexed relayHub
    );

    event HubUnauthorized(
        address indexed registree,
        address indexed relayHub,
        uint256 removalBlock
    );

    /// @param stake - amount of ether staked for this relay
    /// @param unstakeDelay - number of blocks to elapse before the owner can retrieve the stake after calling 'unlock'
    /// @param withdrawBlock - first block number 'withdraw' will be callable, or zero if the unlock has not been called
    /// @param owner - address that receives revenue and manages registree's stake
    struct StakeInfo {
        uint256 stake;
        uint256 unstakeDelay;
        uint256 withdrawBlock;
        address payable owner;
    }

    struct RelayHubInfo {
        uint256 removalBlock;
    }

    /// maps owners to their registrees
    mapping(address => address) public registrees;

    /// maps registrees to their stakes
    mapping(address => StakeInfo) public stakes;

    /// maps registrees to their authorized hubs map
    mapping(address => mapping(address => RelayHubInfo)) public authorizedHubs;

    /// Put a stake for a registree and set its unstake delay.
    /// If the entry does not exist, it is created, and the caller of this function becomes its owner.
    /// If the entry already exists, only the owner can call this function.
    /// @param registree - address that represents a stake entry and controls relay registrations on relay hubs
    /// @param unstakeDelay - number of blocks to elapse before the owner can retrieve the stake after calling 'unlock'
    function stakeForAddress(address registree, uint256 unstakeDelay) external payable {
        require(registrees[msg.sender] == address(0) || registrees[msg.sender] == registree, "different stake exists");
        require(stakes[registree].owner == address(0) || stakes[registree].owner == msg.sender, "not owner");
        require(unstakeDelay >= stakes[registree].unstakeDelay, "unstakeDelay cannot be decreased");
        require(msg.sender != registree, "registree cannot stake for itself");
        require(stakes[msg.sender].owner == address(0), "sender is a registree itself");
        registrees[msg.sender] = registree;
        stakes[registree].owner = msg.sender;
        stakes[registree].stake += msg.value;
        stakes[registree].unstakeDelay = unstakeDelay;
        emit StakeAdded(registree, stakes[registree].owner, stakes[registree].stake, stakes[registree].unstakeDelay);
    }

    function unlockStake() external {
        address registree = registrees[msg.sender];
        StakeInfo storage info = stakes[registree];
        require(registree != address(0), "not owner");
        require(info.withdrawBlock == 0, "already pending");
        info.withdrawBlock = block.number + info.unstakeDelay;
        emit StakeUnlocked(registree, msg.sender, info.withdrawBlock);
    }

    function withdrawStake() external {
        address registree = registrees[msg.sender];
        require(registree != address(0), "not owner");
        require(stakes[registree].withdrawBlock > 0, "Withdrawal is not scheduled");
        require(stakes[registree].withdrawBlock <= block.number, "Withdrawal is not due");
        uint256 amount = stakes[registree].stake;
        delete stakes[registree];
        delete registrees[msg.sender];
        msg.sender.transfer(amount);
        emit StakeWithdrawn(registree, msg.sender, amount);
    }

    function authorizeHub(address relayHub) external {
        address registree = registrees[msg.sender];
        require(registree != address(0), "not owner");
        authorizedHubs[registree][relayHub].removalBlock = uint(-1);
        emit HubAuthorized(registree, relayHub);
    }

    function unauthorizeHub(address relayHub) external {
        address registree = registrees[msg.sender];
        require(registree != address(0), "not owner");
        RelayHubInfo storage hubInfo = authorizedHubs[registree][relayHub];
        require(hubInfo.removalBlock == uint(-1), "hub not authorized");
        uint256 removalBlock = block.number + stakes[registree].unstakeDelay;
        hubInfo.removalBlock = removalBlock;
        emit HubUnauthorized(registree, relayHub, removalBlock);
    }

    function isRegistreeStaked(address registree, uint256 minAmount, uint256 minUnstakeDelay)
    external
    view
    returns (bool) {
        StakeInfo storage info = stakes[registree];
        bool isAmountSufficient = info.stake > minAmount;
        bool isDelaySufficient = info.unstakeDelay > minUnstakeDelay;
        bool isStakeLocked = info.withdrawBlock == 0;
        bool isHubAuthorized = authorizedHubs[registree][msg.sender].removalBlock == uint(-1);
        return
        isAmountSufficient &&
        isDelaySufficient &&
        isStakeLocked &&
        isHubAuthorized;
    }

    /// Slash the stake of the relay registree. In order to prevent stake kidnapping, burns half of stake on the way.
    /// @param registree - entry to penalize
    /// @param beneficiary - address that receives half of the penalty amount
    /// @param amount - amount to withdraw from stake
    function penalizeRegistree(address registree, address payable beneficiary, uint256 amount) external {
        require(authorizedHubs[registree][msg.sender].removalBlock > block.number, "hub not authorized");

        // Half of the stake will be burned (sent to address 0)
        require(stakes[registree].stake >= amount, "penalty exceeds stake");
        stakes[registree].stake = SafeMath.sub(stakes[registree].stake, amount);

        uint256 toBurn = SafeMath.div(amount, 2);
        uint256 reward = SafeMath.sub(amount, toBurn);

        // Ether is burned and transferred
        address(0).transfer(toBurn);
        beneficiary.transfer(reward);
        emit StakePenalized(registree, beneficiary, reward);
    }
}
