//SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.6;

import "../utils/LRUList.sol";

contract TestLRUList is LRUList {

    mapping(address => uint) public values;

    function setValue(address item, address prevItem, uint value) external {
        moveToTop(item, prevItem);
        values[item] = value;
    }

    function readValues(uint maxCount) public view returns (uint[] memory ret) {
        (ret,) = readValuesFrom(address(this), maxCount);
    }

    function readValuesFrom(address from, uint maxCount) public view returns (uint[] memory ret, address nextFrom) {
        address[] memory items;
        (items, nextFrom) = readItemsFrom(from, maxCount);
        ret = new uint[](items.length);
        for (uint i = 0; i < items.length; i++) {
            ret[i] = values[items[i]];
        }
    }
}