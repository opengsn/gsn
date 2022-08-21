// solhint-disable not-rely-on-time
//SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.6;
/* solhint-disable no-inline-assembly */

// #if ENABLE_CONSOLE_LOG
import "hardhat/console.sol";
// #endif

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./MinLibBytes.sol";
import "../interfaces/IRelayHub.sol";
import "../interfaces/IRelayRegistrar.sol";

/**
 * @title The RelayRegistrar Implementation
 * @notice Keeps a list of registered relayers.
 *
 * @notice Provides view functions to read the list of registered relayers and filters out invalid ones.
 *
 * @notice Protects the list from spamming entries: only staked relayers are added.
 */
contract RelayRegistrar is IRelayRegistrar, Ownable, ERC165 {
    using MinLibBytes for bytes;

    uint256 private constant MAX_RELAYS_RETURNED_COUNT = 1000;

    /// @notice Mapping from `RelayHub` address to a mapping from a Relay Manager address to its registration details.
    mapping(address => mapping(address => RelayInfo)) internal values;

    /// @notice Mapping from `RelayHub` address to an array of Relay Managers that are registered on that `RelayHub`.
    mapping(address => address[]) internal indexedValues;

    uint256 private immutable creationBlock;

    uint256 private relayRegistrationMaxAge;

    constructor(uint256 _relayRegistrationMaxAge) {
        setRelayRegistrationMaxAge(_relayRegistrationMaxAge);
        creationBlock = block.number;
    }

    /// @inheritdoc IRelayRegistrar
    function getCreationBlock() external override view returns (uint256){
        return creationBlock;
    }

    /// @inheritdoc IRelayRegistrar
    function getRelayRegistrationMaxAge() external override view returns (uint256){
        return relayRegistrationMaxAge;
    }

    /// @inheritdoc IRelayRegistrar
    function setRelayRegistrationMaxAge(uint256 _relayRegistrationMaxAge) public override onlyOwner {
        relayRegistrationMaxAge = _relayRegistrationMaxAge;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IRelayRegistrar).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IRelayRegistrar
    function registerRelayServer(
        address relayHub,
        bytes32[3] calldata url
    ) external override {
        address relayManager = msg.sender;
        IRelayHub(relayHub).onRelayServerRegistered(relayManager);
        emit RelayServerRegistered(relayManager, relayHub, url);
        storeRelayServerRegistration(relayManager, relayHub, url);
    }

    function addItem(address relayHub, address relayManager) internal returns (RelayInfo storage) {
        RelayInfo storage storageInfo = values[relayHub][relayManager];
        if (storageInfo.lastSeenBlockNumber == 0) {
            indexedValues[relayHub].push(relayManager);
        }
        return storageInfo;
    }

    function storeRelayServerRegistration(
        address relayManager,
        address relayHub,
        bytes32[3] calldata url
    ) internal {
        RelayInfo storage storageInfo = addItem(relayHub, relayManager);
        if (storageInfo.firstSeenBlockNumber == 0) {
            storageInfo.firstSeenBlockNumber = uint32(block.number);
            storageInfo.firstSeenTimestamp = uint40(block.timestamp);
        }
        storageInfo.lastSeenBlockNumber = uint32(block.number);
        storageInfo.lastSeenTimestamp = uint40(block.timestamp);
        storageInfo.relayManager = relayManager;
        storageInfo.urlParts = url;
    }

    /// @inheritdoc IRelayRegistrar
    function getRelayInfo(address relayHub, address relayManager) public view override returns (RelayInfo memory) {
        RelayInfo memory info = values[relayHub][relayManager];
        require(info.lastSeenBlockNumber != 0, "relayManager not found");
        return info;
    }

    /// @inheritdoc IRelayRegistrar
    function readRelayInfos(
        address relayHub
    )
    public
    view
    override
    returns (
        RelayInfo[] memory info
    ) {
        uint256 blockTimestamp = block.timestamp;
        uint256 oldestBlockTimestamp = blockTimestamp >= relayRegistrationMaxAge ? blockTimestamp - relayRegistrationMaxAge : 0;
        return readRelayInfosInRange(relayHub, 0, oldestBlockTimestamp, MAX_RELAYS_RETURNED_COUNT);
    }

    /// @inheritdoc IRelayRegistrar
    function readRelayInfosInRange(
        address relayHub,
        uint256 oldestBlockNumber,
        uint256 oldestBlockTimestamp,
        uint256 maxCount
    )
    public
    view
    override
    returns (
        RelayInfo[] memory info
    ) {
        address[] storage items = indexedValues[relayHub];
        uint256 filled = 0;
        info = new RelayInfo[](items.length < maxCount ? items.length : maxCount);
        for (uint256 i = 0; i < items.length; i++) {
            address relayManager = items[i];
            RelayInfo memory relayInfo = getRelayInfo(relayHub, relayManager);
            if (
                relayInfo.lastSeenBlockNumber < oldestBlockNumber ||
                relayInfo.lastSeenTimestamp < oldestBlockTimestamp
            ) {
                continue;
            }
            // solhint-disable-next-line no-empty-blocks
            try IRelayHub(relayHub).verifyRelayManagerStaked(relayManager) {
            } catch (bytes memory /*lowLevelData*/) {
                continue;
            }
            info[filled++] = relayInfo;
            if (filled >= maxCount)
                break;
        }
        assembly { mstore(info, filled) }
    }
}
