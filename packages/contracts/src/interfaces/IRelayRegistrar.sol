//SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/interfaces/IERC165.sol";

/**
 * @title The RelayRegistrar Interface
 * @notice The on-chain registrar for all registered Relay Managers.
 *
 * @notice The client can use an implementation of a `RelayRegistrar` to find relay registration info.
 *
 * @notice Clients can use either events or on-chain querying mechanism depending on which one is more accessible.
 * The on-chain querying may be switched off and can be checked by a call to `isUsingStorageRegistry()` function.
 */
interface IRelayRegistrar is IERC165 {

    /**
     * @notice A struct containing all the information necessary to client to interact with the Relay Server.
     */
    struct RelayInfo {
        //last registration block number
        uint256 lastBlockNumber;
        //stake (first registration) block number
        uint256 stakeBlockNumber;
        address relayManager;
        uint256 baseRelayFee;
        uint256 pctRelayFee;
        string url;
    }

    /**
     * @notice Emitted when a relay server registers or updates its details.
     * Looking up these events allows a client to discover registered Relay Servers.
     */
    event RelayServerRegistered(
        address indexed relayManager,
        uint256 baseRelayFee,
        uint256 pctRelayFee,
        string relayUrl
    );

    /**
     * @notice This function is called by Relay Servers in order to register or to update their registration.
     * @param baseRelayFee The base fee the Relay Server charges for a single transaction in Ether, in wei.
     * @param pctRelayFee The percent of the total charge to add as a Relay Server fee to the total charge.
     * @param url The URL of the Relay Server that is listening to the clients' requests.
     */
    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external;

    /**
     * @return The block number in which the contract has been deployed.
     */
    function getCreationBlock() external view returns (uint256);

    /**
     * @return `true` if this `RelayRegistrar` keeps registrations on-chain in storage in addition to emitting events.
     * `false` if only events are emitted as part of Relay Server registration on this `RelayRegistrar`.
     */
    function isUsingStorageRegistry() external returns (bool);

    /**
     * @param relayManager An address of a Relay Manager.
     * @return info All the details of the given Relay Manager's registration.
     */
    function getRelayInfo(address relayManager) external view returns (RelayInfo memory info);

    /**
     * @notice Read relay info of registered Relay Server from an on-chain storage.
     * @param maxCount The maximum amount of relays to be returned by this function.
     * @param oldestBlock The latest block number in which a Relay Server may be registered in order to be returned.
     * @return info The list of `RelayInfo`s or registered Relay Servers
     * @return filled The number of entries filled in info. Entries in returned array that are not filled will be empty.
     */
    function readRelayInfos(uint256 oldestBlock, uint256 maxCount) external view returns (RelayInfo[] memory info, uint256 filled);
}
