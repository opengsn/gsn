pragma solidity ^0.8.6;
//SPDX-License-Identifier: UNLICENSED

import "./LRUList.sol";
import "../interfaces/IRelayRegistrar.sol";

contract RelayRegistrar is LRUList, IRelayRegistrar {

    struct RelayStorageInfo {
        uint96 blockNumber;
        uint96 baseRelayFee;
        uint96 pctRelayFee;
        bytes32[3] urlParts;
    }

    mapping(address => RelayStorageInfo) public values;

    address immutable relayHub;

    constructor(address _relayHub) {
        relayHub = _relayHub;
    }

    function registerRelayer( address prevItem, RelayInfo calldata info) external override {
        require(msg.sender == relayHub, "not called from RelayHub");

        address relayer = info.relayer;
        if ( prevItem==address (0)) {
            //try to find prevItem. can be expensive if the list is large.
            prevItem = getPrev(relayer);
        }
        moveToTop(relayer, prevItem);
        RelayStorageInfo storage storageInfo = values[relayer];
        storageInfo.blockNumber = uint96(info.blockNumber);
        storageInfo.baseRelayFee = uint96(info.baseRelayFee);
        storageInfo.pctRelayFee = uint96(info.pctRelayFee);
        bytes32[3] memory parts = splitString(info.url);
        storageInfo.urlParts = parts;
    }

    function getRelayInfo(address relayer) public view override returns (RelayInfo memory info) {
        RelayStorageInfo storage storageInfo = values[relayer];
        require(storageInfo.blockNumber != 0, "relayer not found");
        info.blockNumber = storageInfo.blockNumber;
        info.baseRelayFee = storageInfo.baseRelayFee;
        info.pctRelayFee = storageInfo.pctRelayFee;
        info.relayer = relayer;
        info.url = packString(storageInfo.urlParts);
    }

    function readValues(uint maxCount) view public override returns (RelayInfo[] memory info) {
        (info,) = readValuesFrom(address(this), maxCount);
    }

    function readValuesFrom(address from, uint maxCount) view public returns (RelayInfo[] memory ret, address nextFrom) {
        address[] memory items;
        (items, nextFrom) = readItemsFrom(from, maxCount);
        ret = new RelayInfo[](items.length);
        for (uint i = 0; i < items.length; i++) {
            ret[i] = getRelayInfo(items[i]);
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
