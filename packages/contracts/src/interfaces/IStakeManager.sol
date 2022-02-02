// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakeManager {

    /// Emitted when a stake or unstakeDelay are initialized or increased
    event StakeAdded(
        address indexed relayManager,
        address indexed owner,
        IERC20 token,
        uint256 stake,
        uint256 unstakeDelay
    );

    /// Emitted once a stake is scheduled for withdrawal
    event StakeUnlocked(
        address indexed relayManager,
        address indexed owner,
        uint256 withdrawTime
    );

    /// Emitted when owner withdraws relayManager funds
    event StakeWithdrawn(
        address indexed relayManager,
        address indexed owner,
        IERC20 token,
        uint256 amount
    );

    /// Emitted when an authorized Relay Hub penalizes a relayManager
    event StakePenalized(
        address indexed relayManager,
        address indexed beneficiary,
        IERC20 token,
        uint256 reward
    );

    event HubAuthorized(
        address indexed relayManager,
        address indexed relayHub
    );

    event HubUnauthorized(
        address indexed relayManager,
        address indexed relayHub,
        uint256 removalTime
    );

    event OwnerSet(
        address indexed relayManager,
        address indexed owner
    );

    event BurnAddressSet(
        address indexed burnAddress
    );

    /// @param stake - amount of ether staked for this relay
    /// @param unstakeDelay - number of seconds to elapse before the owner can retrieve the stake after calling 'unlock'
    /// @param withdrawTime - timestamp in seconds when 'withdraw' will be callable, or zero if the unlock has not been called
    /// @param owner - address that receives revenue and manages relayManager's stake
    struct StakeInfo {
        uint256 stake;
        uint256 unstakeDelay;
        uint256 withdrawTime;
        IERC20 token;
        address owner;
    }

    struct RelayHubInfo {
        uint256 removalTime;
    }

    /// Set the owner of a Relay Manager. Called only by the RelayManager itself.
    /// Note that owners cannot transfer ownership - if the entry already exists, reverts.
    /// @param owner - owner of the relay (as configured off-chain)
    function setRelayManagerOwner(address owner) external;

    /// Put a stake for a relayManager and set its unstake delay.
    /// Only the owner can call this function. If the entry does not exist, reverts.
    /// The owner must give allowance of the ERC-20 token to the StakeManager before calling this method.
    /// It is the RelayHub who has a configurable list of minimum stakes per token. StakeManager accepts all tokens.
    /// @param token - address of an ERC-20 token that is used by the relayManager as a stake
    /// @param relayManager - address that represents a stake entry and controls relay registrations on relay hubs
    /// @param unstakeDelay - number of seconds to elapse before the owner can retrieve the stake after calling 'unlock'
    /// @param amount - amount of tokens to be taken from the relayOwner and locked in the StakeManager as a stake
    function stakeForRelayManager(IERC20 token, address relayManager, uint256 unstakeDelay, uint256 amount) external;

    function unlockStake(address relayManager) external;

    function withdrawStake(address relayManager) external;

    function authorizeHubByOwner(address relayManager, address relayHub) external;

    function authorizeHubByManager(address relayHub) external;

    function unauthorizeHubByOwner(address relayManager, address relayHub) external;

    function unauthorizeHubByManager(address relayHub) external;

    /// Slash the stake of the relay relayManager. In order to prevent stake kidnapping, burns half of stake on the way.
    /// @param relayManager - entry to penalize
    /// @param beneficiary - address that receives half of the penalty amount
    /// @param amount - amount to withdraw from stake
    function penalizeRelayManager(address relayManager, address beneficiary, uint256 amount) external;

    function getStakeInfo(address relayManager) external view returns (StakeInfo memory stakeInfo, bool isSenderAuthorizedHub);

    function maxUnstakeDelay() external view returns (uint256);

    function setBurnAddress(address _burnAddress) external;

    function burnAddress() external view returns (address);

    /**
     * @return the block number in which the contract has been deployed.
     */
    function getCreationBlock() external view returns (uint256);

    function versionSM() external view returns (string memory);
}
