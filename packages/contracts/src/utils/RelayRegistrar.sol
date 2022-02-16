//SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.6;
/* solhint-disable no-inline-assembly */

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import "./MinLibBytes.sol";
import "../interfaces/IRelayHub.sol";
import "../interfaces/IRelayRegistrar.sol";

/**
 * on-chain relayer registrar.
 * - keep a list of registered relayers (using registerRelayer).
 * - provide view functions to read the list of registered relayers (and filter out invalid ones)
 * - protect the list from spamming entries: only staked relayers are added.
 */
contract RelayRegistrar is IRelayRegistrar, ERC165 {
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
    uint256 private immutable creationBlock;

    IRelayHub public immutable relayHub;

    constructor(IRelayHub _relayHub, bool _isUsingStorageRegistry) {
        creationBlock = block.number;
        relayHub = _relayHub;
        isUsingStorageRegistry = _isUsingStorageRegistry;
    }

    function getCreationBlock() external override view returns (uint256){
        return creationBlock;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IRelayRegistrar).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IRelayRegistrar
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

    function storeRelayServerRegistration(address relayManager, uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) internal {
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

    /// @inheritdoc IRelayRegistrar
    function getRelayInfo(address relayManager) public view override returns (RelayInfo memory) {
        RelayInfo memory info;
        RelayStorageInfo storage storageInfo = values[relayManager];
        require(storageInfo.lastBlockNumber != 0, "relayManager not found");
        info.lastBlockNumber = storageInfo.lastBlockNumber;
        info.stakeBlockNumber = storageInfo.stakeBlockNumber;
        info.baseRelayFee = storageInfo.baseRelayFee;
        info.pctRelayFee = storageInfo.pctRelayFee;
        info.relayManager = relayManager;
        info.url = packString(storageInfo.urlParts);
        return info;
    }

    /// @inheritdoc IRelayRegistrar
    function readRelayInfos(uint256 oldestBlock, uint256 maxCount) public view override returns (RelayInfo[] memory info, uint256 filled) {
        address[] storage items = indexedValues;
        filled = 0;
        info = new RelayInfo[](items.length < maxCount ? items.length : maxCount);
        for (uint256 i = 0; i < items.length; i++) {
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

    /**
     * @notice Splits the variable size string array into static size bytes array. See `packString` for reverse.
     * @param str The string to be split.
     * @return The same string split into parts.
     */
    function splitString(string calldata str) public pure returns (bytes32[3] memory) {
        bytes32[3] memory parts;
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
        return parts;
    }

    /**
     * @notice Packs a string back after being split in `splitString`.
     * @param parts The string split into parts.
     * @return str The same string joined back together.
     */
    function packString(bytes32[3] memory parts) public pure returns (string memory str) {
        bytes memory ret = bytes.concat(parts[0], parts[1], parts[2]);
        //trim trailing zeros
        uint256 len = ret.length - 1;
        while (len > 0 && ret[len] == 0) len--;
        assembly {
            mstore(ret, add(len, 1))
        }
        str = string(ret);
    }
}
