// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../bls/utils/CacheLibrary.sol";

contract TestCacheLibrary {
    using CacheLibrary for CacheLibrary.WordCache;

    CacheLibrary.WordCache private testCache;

    function queryAndUpdateCache(uint256 id) public returns (uint256){
        return testCache.queryAndUpdateCache(id);
    }

    function convertWordsToIds(
        uint256[][] memory words
    )
    external
    view
    returns (
        uint256[][] memory ret
    ) {
        ret = new uint256[][](4);
        ret[0] = testCache.convertWordsToIdsInternal(words[0]);
        return ret;
    }
}
