pragma solidity ^0.8.6;
//SPDX-License-Identifier: UNLICENSED

/**
 * LRU List: keep least-recently added item at the top of the list.
 * each item is an address.
 * subclass should add
 * - setValue(address, value) method
 * 	- internally call moveToTop() and keep value in storage
 * - readValues(max) - to read first values
 * 	- call readItems(max) and iterate storage to read values.
 */
contract LRUList {

    //need some "maximum" value. MAX_UINT is as good..
    uint constant private MAX = type(uint32).max;

    mapping(address => address) public next;

    constructor() {
        address head = address(this);
        next[head] = head;
    }

    //item must be either completely new, (with prev=address(0), (and get added at the head of the list)
    // or already in the list, where next(prev)==addr (and will be moved to the head of the list)
    // use view-function helper: prevItem = contract.prev(addr)
    // move the given address to the top of the list.
    // if item is new, i
    function moveToTop(address addr, address prevItem) internal {
        address head = address(this);
        if (prevItem == address(0)) {
            require(next[addr] == address(0), "no prevItem for existing item");
            next[addr] = next[head];
            next[head] = addr;
        } else {
            // before: head ->         first  ..  prev -> addr -> another
            // after:  head -> addr -> first  ..  prev ->         another

            require(next[prevItem] == addr, "given wrong prevItem");
            address nextHead = next[head];
            if ( nextHead != addr) {
                address addrNext = next[addr];
                next[addr] = nextHead;
                next[head] = addr;
                next[prevItem] = addrNext;
            }
        }
    }

    /**
     * count all items in the list.
     */
    function countItems() public view returns (uint ret) {
        (ret,) = countFrom(address(this), MAX);
    }

    /**
     * partial list count (in case the list is insanely large)
     * if max is reached, then "nextFrom" is set to the value to give "from" on the next call
     * @param from - start after this item (use "this" to count all)
     * @param max - maximum count to return
     */
    function countFrom(address from, uint max) public view returns (uint ret, address nextFrom){
        ret = 0;
        address head = address(this);
        address p = next[from];
        require(p != address(0), "from not in list");
        for (;;) {
            if (p == head) {
                return (ret, address(0));
            }
            ret++;
            if (ret >= max) {
                return (ret, p);
            }
            p = next[p];
        }
    }

    /**
     * read all items.
     */
    function readAllItems() public view returns (address[] memory ret) {
        (ret,) = readItemsFrom(address(this), MAX);
    }

    function readItemsFrom(address from, uint max) public view returns (address[] memory ret, address nextFrom) {
        uint count;
        (count, nextFrom) = countFrom(from, max);
        ret = new address[](count);
        address pos = from;
        for (uint i = 0; i < count; i++) {
            pos = next[pos];
            ret[i] = pos;
        }
    }

    //find item previous to given item.
    // (works well for normal count. use prevFrom for insanely huge lists)
    function getPrev(address item) public view returns (address ret) {
        //check if not in list (instead of revert)
        if ( next[item]==address(0))
            return address (0);
        (ret,) = prevFrom(item, address(this), MAX);
    }


    //scan list in chunks
    // item - the item to find the predecessor of.
    // from - the first address to lookup from. initialize to "this" on first call.
    // scanCount - max calls to attempt
    // returns: (ret,null) - "ret" is the predecessor of "item"
    //      (null,nextFrom) - didn't find result. repeat calling this method with (item,nextFrom,count)
    function prevFrom(address item, address from, uint scanCount) public view returns (address ret, address nextFrom) {
        require(next[item] != address(0), "item not in list");
        address p = from;
        for (uint i = 0; i < scanCount; i++) {
            address pNext = next[p];

            require(pNext != address(0), "item not in list");
            if (pNext == item)
                return (p, address(0));

            if (pNext == address(this)) {
                break;
            }
            p = pNext;
        }
        return (address(0), p);
    }
}
