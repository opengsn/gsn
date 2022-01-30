//SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.6;
/* solhint-disable no-inline-assembly */

import "./MinLibBytes.sol";
import "../interfaces/IRelayHub.sol";
import "../interfaces/IRelayRegistrar.sol";

/**
 * on-chain relayer registrar.
 * - keep a list of registered relayers (using registerRelayer).
 * - provide view functions to read the list of registered relayers (and filter out invalid ones)
 * - protect the list from spamming entries: only staked relayers are added.
 */
contract RelayRegistrar is IRelayRegistrar {
    using MinLibBytes for bytes;

    struct RelayStorageInfo {
        uint32 lastBlockNumber;
        uint32 stakeBlockNumber;
        uint96 baseRelayFee;
        uint96 pctRelayFee;
        bytes32[3] urlParts;
    }

    mapping(address => RelayStorageInfo) public values;
    address[] public indexedValues;

    bool public immutable override isUsingStorageRegistry;

    IRelayHub public immutable relayHub;

    constructor(IRelayHub _relayHub, bool _isUsingStorageRegistry) {
        relayHub = _relayHub;
        isUsingStorageRegistry = _isUsingStorageRegistry;
    }

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external override {
        address relayManager = msg.sender;
        if (address(relayHub) != address(0)) {
            relayHub.verifyCanRegister(relayManager);
        }
        emit RelayServerRegistered(relayManager, baseRelayFee, pctRelayFee, url);
        if (isUsingStorageRegistry) {
            storeRelayServerRegistration(relayManager, baseRelayFee, pctRelayFee, url);
        }
    }

    function addItem(address relayManager) internal returns (RelayStorageInfo storage) {
        RelayStorageInfo storage storageInfo = values[relayManager];
        if (storageInfo.lastBlockNumber == 0) {
            indexedValues.push(relayManager);
        }
        return storageInfo;
    }

    function storeRelayServerRegistration(address relayManager, uint baseRelayFee, uint pctRelayFee, string calldata url) internal {
        RelayStorageInfo storage storageInfo = addItem(relayManager);
        if (storageInfo.stakeBlockNumber==0) {
            storageInfo.stakeBlockNumber = uint32(block.number);
        }
        storageInfo.lastBlockNumber = uint32(block.number);
        storageInfo.baseRelayFee = uint96(baseRelayFee);
        storageInfo.pctRelayFee = uint96(pctRelayFee);
        bytes32[3] memory parts = splitString(url);
        storageInfo.urlParts = parts;
    }

    function getRelayInfo(address relayManager) public view override returns (RelayInfo memory info) {
        RelayStorageInfo storage storageInfo = values[relayManager];
        require(storageInfo.lastBlockNumber != 0, "relayManager not found");
        info.lastBlockNumber = storageInfo.lastBlockNumber;
        info.stakeBlockNumber = storageInfo.stakeBlockNumber;
        info.baseRelayFee = storageInfo.baseRelayFee;
        info.pctRelayFee = storageInfo.pctRelayFee;
        info.relayManager = relayManager;
        info.url = packString(storageInfo.urlParts);
    }

    /**
     * read relay info of registered relays
     * @param maxCount - return at most that many relays
     * @param oldestBlock - return only relays registered from this block on.
     * @return info - list of RelayInfo for registered relays
     * @return filled - # of entries filled in info (last entries in returned array might be empty)
     */
    function readRelayInfos(uint oldestBlock, uint maxCount) public view override returns (RelayInfo[] memory info, uint filled) {
        address[] storage items = indexedValues;
        filled = 0;
        info = new RelayInfo[](items.length < maxCount ? items.length : maxCount);
        for (uint i = 0; i < items.length; i++) {
            address relayManager = items[i];
            RelayInfo memory relayInfo = getRelayInfo(relayManager);
            if (relayInfo.lastBlockNumber < oldestBlock) {
                continue;
            }
            if (address(relayHub) != address(0)) {
                // solhint-disable-next-line no-empty-blocks
                try IRelayHub(relayHub).verifyRelayManagerStaked(relayManager) {
                } catch (bytes memory /*lowLevelData*/) {
                    continue;
                }
            }
            info[filled++] = relayInfo;
            if (filled >= maxCount)
                break;
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
