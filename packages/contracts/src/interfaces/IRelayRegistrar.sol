pragma solidity ^0.8.6;
//SPDX-License-Identifier: UNLICENSED

/**
 * on-chain registrar for all registered relayers.
 * client can use it instead of events to find relay registration info.
 * NOTE: client should IGNORE the order of these requests.
 */
interface IRelayRegistrar {

    struct RelayInfo {
        uint blockNumber;
        address relayer;
        uint baseRelayFee;
        uint pctRelayFee;
        string url;
    }

    function registerRelayer( address prevItem, RelayInfo calldata info) external;

    function getRelayInfo(address relayer) external view returns (RelayInfo memory info);

    function readValues(uint maxCount) external view returns (RelayInfo[] memory info);
}
