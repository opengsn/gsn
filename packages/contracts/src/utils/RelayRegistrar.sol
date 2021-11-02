pragma solidity ^0.8.6;
//SPDX-License-Identifier: UNLICENSED
/* solhint-disable no-inline-assembly */

import "./LRUList.sol";
import "./MinLibBytes.sol";
import "../interfaces/IRelayHub.sol";
import "../interfaces/IRelayRegistrar.sol";

/**
 * on-chain relayer registrar.
 * - keep a list of registered relayers (using registerRelayer).
 * - provide view functions to read the list of registered relayers (and filter out invalid oines
 * - protect the list from spamming entries: only staked relayers are added.
 * - the list is an LRU, so can use "registered in past x blocks" policy
 * implementation issues:
 * - subclass must provide isRelayManagerStaked(address) method (available in IRelayHub) to
 *   filter out invalid relays
 */

contract RelayRegistrar is LRUList, IRelayRegistrar {
    using MinLibBytes for bytes;

    struct RelayStorageInfo {
        uint96 blockRegistered;
        uint96 baseRelayFee;
        uint96 pctRelayFee;
        bytes32[3] urlParts;
    }

    mapping(address => RelayStorageInfo) public values;

    bool public immutable override usingSavedState;

    IRelayHub public immutable relayHub;

    constructor(IRelayHub _relayHub, bool _usingSavedState) {
        relayHub = _relayHub;
        usingSavedState = _usingSavedState;
    }

    function registerRelayServer(address prevItem, uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external override {
        address relayManager = msg.sender;
        if (address(relayHub) != address(0)) {
            relayHub.verifyCanRegister(relayManager);
        }
        emit RelayServerRegistered(relayManager, baseRelayFee, pctRelayFee, url);
        if (usingSavedState) {
            _registerRelay(prevItem, relayManager, baseRelayFee, pctRelayFee, url);
        }
    }

    function _registerRelay(address prevItem, address relayManager, uint baseRelayFee, uint pctRelayFee, string calldata url) internal {
        if (prevItem == address(0)) {
            //try to find prevItem. can be expensive if the list is large.
            prevItem = getPrev(relayManager);
        }
        moveToTop(relayManager, prevItem);
        RelayStorageInfo storage storageInfo = values[relayManager];
        storageInfo.blockRegistered = uint96(block.number);
        storageInfo.baseRelayFee = uint96(baseRelayFee);
        storageInfo.pctRelayFee = uint96(pctRelayFee);
        bytes32[3] memory parts = splitString(url);
        storageInfo.urlParts = parts;
    }

    function getRelayInfo(address relayManager) public view override returns (RelayInfo memory info) {
        RelayStorageInfo storage storageInfo = values[relayManager];
        require(storageInfo.blockRegistered != 0, "relayManager not found");
        info.blockNumber = storageInfo.blockRegistered;
        info.baseRelayFee = storageInfo.baseRelayFee;
        info.pctRelayFee = storageInfo.pctRelayFee;
        info.relayManager = relayManager;
        info.url = packString(storageInfo.urlParts);
    }

    /**
     * read relay info of registered relays
     * @param oldestBlock - stop filling relays last registered at this block (the list is "least-recently-added", so
     *  sorted by block number
     * @param maxCount - return at most that many relays from the beginning of the list
     * @return info - list of RelayInfo for registered relays
     * @return filled - # of entries filled in info (last entries in returned array might be empty)
     */
    function readRelayInfos(uint oldestBlock, uint maxCount) public view override returns (RelayInfo[] memory info, uint filled) {
        (info, filled,) = readRelayInfosFrom(address(this), oldestBlock, maxCount);
    }

    function readRelayInfosFrom(address from, uint oldestBlock, uint maxCount) public view override returns (RelayInfo[] memory ret, uint filled, address nextFrom) {
        address[] memory items;
        (items, nextFrom) = readItemsFrom(from, maxCount);
        filled = 0;
        ret = new RelayInfo[](items.length);
        for (uint i = 0; i < items.length; i++) {
            address relayManager = items[i];
            RelayInfo memory info = getRelayInfo(relayManager);
            if (address(relayHub) == address(0) || IRelayHub(relayHub).isRelayManagerStaked(relayManager)) {
                ret[filled++] = info;
            }
            if (info.blockNumber < oldestBlock) {
                break;
            }
        }
    }

    function countRelays() external view override returns (uint) {
        return countItems();
    }

    function splitString(string calldata str) public pure returns (bytes32[3] memory parts) {
        bytes calldata url = bytes(str);
        require(url.length <= 96, "url too long");
        parts[0] = bytes32(url[0 :]);
        if (url.length > 32) {
            parts[1] = bytes32(url[32 :]);
            if (url.length > 64) {
                parts[2] = bytes32(url[64 :]);
            } else {
                parts[2] = 0;
            }
        } else {
            parts[1] = 0;
            parts[2] = 0;
        }
    }

    function packString(bytes32[3] memory parts) public pure returns (string memory str) {
        bytes memory ret = bytes.concat(parts[0], parts[1], parts[2]);
        //trim trailing zeros
        uint len = ret.length - 1;
        while (len > 0 && ret[len] == 0) len--;
        assembly {
            mstore(ret, add(len, 1))
        }
        str = string(ret);
    }
}
