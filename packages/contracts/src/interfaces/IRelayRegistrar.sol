//SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/interfaces/IERC165.sol";

/**
 * @title The RelayRegistrar Interface
 * @notice The on-chain registrar for all registered Relay Managers.
 *
 * @notice The client can use an implementation of a `RelayRegistrar` to find relay registration info.
 *
 */
interface IRelayRegistrar is IERC165 {

    /**
     * @notice A struct containing all the information necessary to client to interact with the Relay Server.
     */
    struct RelayInfo {
        //last registration block number
        uint32 lastSeenBlockNumber;
        //last registration block timestamp
        uint40 lastSeenTimestamp;
        //stake (first registration) block number
        uint32 firstSeenBlockNumber;
        //stake (first registration) block timestamp
        uint40 firstSeenTimestamp;
        bytes32[3] urlParts;
        address relayManager;
    }

    /**
     * @notice Emitted when a relay server registers or updates its details.
     * Looking up these events allows a client to discover registered Relay Servers.
     */
    event RelayServerRegistered(
        address indexed relayManager,
        address indexed relayHub,
        bytes32[3] relayUrl
    );

    /**
     * @notice This function is called by Relay Servers in order to register or to update their registration.
     * @param relayHub The address of the `RelayHub` contract for which this action is performed.
     * @param url The URL of the Relay Server that is listening to the clients' requests.
     */
    function registerRelayServer(
        address relayHub,
        bytes32[3] calldata url
    ) external;

    /**
     * @return The block number in which the contract has been deployed.
     */
    function getCreationBlock() external view returns (uint256);

    /**
     * @return The maximum age the relay is considered registered by default by this `RelayRegistrar`, in seconds.
     */
    function getRelayRegistrationMaxAge() external view returns (uint256);

    /**
     * @notice Change the maximum relay registration age.
     */
    function setRelayRegistrationMaxAge(uint256) external;

    /**
     * @param relayManager An address of a Relay Manager.
     * @param relayHub The address of the `RelayHub` contract for which this action is performed.
     * @return info All the details of the given Relay Manager's registration. Throws if relay not found for `RelayHub`.
     */
    function getRelayInfo(address relayHub, address relayManager) external view returns (RelayInfo memory info);

    /**
     * @notice Read relay info of registered Relay Server from an on-chain storage.
     * @param relayHub The address of the `RelayHub` contract for which this action is performed.
     * @return info The list of `RelayInfo`s of registered Relay Servers
     */
    function readRelayInfos(
        address relayHub
    ) external view returns (
        RelayInfo[] memory info
    );

    /**
     * @notice Read relay info of registered Relay Server from an on-chain storage.
     * @param relayHub The address of the `RelayHub` contract for which this action is performed.
     * @param maxCount The maximum amount of relays to be returned by this function.
     * @param oldestBlockNumber The latest block number in which a Relay Server may be registered.
     * @param oldestBlockTimestamp The latest block timestamp in which a Relay Server may be registered.
     * @return info The list of `RelayInfo`s of registered Relay Servers
     */
    function readRelayInfosInRange(
        address relayHub,
        uint256 oldestBlockNumber,
        uint256 oldestBlockTimestamp,
        uint256 maxCount
    ) external view returns (
        RelayInfo[] memory info
    );
}
