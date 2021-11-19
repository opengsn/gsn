// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

library CacheLibrary {
    struct WordCache {
        // note: a length of an array after this value was added (zero indicates 'no value')
        mapping(uint256 => uint256) reverse;
        uint256[] cache;
    }

    // defines max cache size allowing bigger values to be considered an actual input
    uint256 public constant ID_MAX_VALUE = 0xffffffff;

    function queryAndUpdateCache(
        WordCache storage wordCache,
        uint256 id
    )
    internal
    returns (uint256) {
        if (id == 0){
            return 0;
        }
        if (id > ID_MAX_VALUE) {
            if (wordCache.reverse[id] == 0) {
                wordCache.cache.push(id);
                wordCache.reverse[id] = wordCache.cache.length;
            }
            return id;
        } else {
            require(id < wordCache.cache.length, "CacheLibrary: invalid id");
            return wordCache.cache[id];
        }
    }

    function convertWordsToIdsInternal(
        WordCache storage wordCache,
        uint256[] memory input
    )
    internal
    view
    returns (uint256[] memory ids) {
        ids = new uint256[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            uint256 id = wordCache.reverse[input[i]];
            // In reverse map, IDs are actually "new array lengths", so that 0 means no value cached
            if (id == 0) {
                ids[i] = input[i];
            } else {
                ids[i] = id - 1;
                // return actual ID as index in an array
            }
        }
    }
}
