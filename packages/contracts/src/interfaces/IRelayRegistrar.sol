pragma solidity ^0.8.6;
//SPDX-License-Identifier: UNLICENSED

/**
 * on-chain registrar for all registered relayManagers.
 * client can use it instead of events to find relay registration info.
 * NOTE: client should IGNORE the order of these requests.
 */
interface IRelayRegistrar {

    struct RelayInfo {
        uint blockNumber;
        address relayManager;
        uint baseRelayFee;
        uint pctRelayFee;
        string url;
    }

    function registerRelayer( address prevItem, RelayInfo calldata info) external;

    //TODO: wrapper for countItems. used only for (type) testing. to be removed.
    function countRelays() external view returns (uint);

    function getRelayInfo(address relayManager) external view returns (RelayInfo memory info);

    function readValues(uint maxCount) external view returns (RelayInfo[] memory info, uint filled);

    function readValuesFrom(address from, uint maxCount) external view returns (RelayInfo[] memory ret, uint filled, address nextFrom);
}
