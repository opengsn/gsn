pragma solidity ^0.8.6;
//SPDX-License-Identifier: UNLICENSED
/* solhint-disable no-inline-assembly */

import "./LRUList.sol";
import "../interfaces/IRelayRegistrar.sol";
import "../interfaces/IRelayHub.sol";

contract RelayRegistrar is LRUList, IRelayRegistrar {

    struct RelayStorageInfo {
        uint96 blockRegistered;
        uint96 baseRelayFee;
        uint96 pctRelayFee;
        bytes32[3] urlParts;
    }

    mapping(address => RelayStorageInfo) public values;

    address public immutable relayHub;

    constructor(address _relayHub) {
        relayHub = _relayHub;
    }

    function countRelays() external view override returns (uint) {
        return countItems();
    }

    function registerRelayer(address prevItem, RelayInfo calldata info) external override {
        require(msg.sender == relayHub || relayHub==address (0), "not called from RelayHub");
        address relayManager = info.relayManager;
        if (prevItem == address(0)) {
            //try to find prevItem. can be expensive if the list is large.
            prevItem = getPrev(relayManager);
        }
        moveToTop(relayManager, prevItem);
        RelayStorageInfo storage storageInfo = values[relayManager];
        storageInfo.blockRegistered = uint96(info.blockNumber);
        storageInfo.baseRelayFee = uint96(info.baseRelayFee);
        storageInfo.pctRelayFee = uint96(info.pctRelayFee);
        bytes32[3] memory parts = splitString(info.url);
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
     * @param maxCount - return at most that many relays from the beginning of the list
     * @return info - list of RelayInfo for registered relays
     * @return filled - # of entries filled in info
     */
    function readValues(uint maxCount) public view override returns (RelayInfo[] memory info, uint filled) {
        (info, filled,) = readValuesFrom(address(this), maxCount);
    }

    function readValuesFrom(address from, uint maxCount) public view override returns (RelayInfo[] memory ret, uint filled, address nextFrom) {
        address[] memory items;
        (items, nextFrom) = readItemsFrom(from, maxCount);
        filled = 0;
        ret = new RelayInfo[](items.length);
        for (uint i = 0; i < items.length; i++) {
            address relayManager = items[i];
            if (relayHub == address(0) || IRelayHub(relayHub).isRelayManagerStaked(relayManager)) {
                ret[filled++] = getRelayInfo(relayManager);
            }
        }
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
