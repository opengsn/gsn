// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "./BLSTypes.sol";

library CacheLibrary {
    // defines max cache size allowing bigger values to be considered an actual address input
    uint256 public constant ADDRESS_ID_MAX_VALUE = 0xffffffff;

    function queryAndUpdateCache(
        BLSTypes.AddressCache storage addressCache,
        uint256 id
    )
    internal
    returns (address) {
        if (id > ADDRESS_ID_MAX_VALUE) {
            address inputAsAddress = address(uint160(id));
            if (addressCache.reverse[inputAsAddress] == 0) {
                addressCache.cache.push(inputAsAddress);
                addressCache.reverse[inputAsAddress] = addressCache.cache.length;
            }
            return inputAsAddress;
        } else {
            require(id < addressCache.cache.length, "address: invalid id");
            return addressCache.cache[id];
        }
    }

    function convertAddressesToIdsInternal(
        BLSTypes.AddressCache storage addressCache,
        address[] memory input
    )
    internal
    view
    returns (uint256[] memory ids) {
        ids = new uint256[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            uint256 id = addressCache.reverse[input[i]];
            // In reverse map, IDs are actually "new array lengths", so that 0 means no value cached
            if (id == 0) {
                ids[i] = uint256(uint160(input[i]));
            } else {
                ids[i] = id - 1;
                // return actual ID as index in an array
            }
        }
    }

    function convertAddressToIdInternal(
        BLSTypes.AddressCache storage addressCache,
        address input)
    internal
    view
    returns (uint256 id) {
        (addressCache, input);
        return 0;
    }
}
