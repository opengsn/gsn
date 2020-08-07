// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
// solhint-disable not-rely-on-time

import "@openzeppelin/contracts/access/Ownable.sol";
pragma experimental ABIEncoderV2;

contract VersionOracle is Ownable {

    mapping(bytes32 => bytes32) public idToVersion;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public versionHistory;
    mapping(bytes32 => mapping(bytes32 => VersionInfo)) public values;

    struct VersionInfo {
        uint64 time;
        bool canceled;
        bytes32 version;
        string value;
    }

    event VersionAdded(bytes32 indexed id, bytes32 version, string value);
    event VersionCanceled(bytes32 indexed id, bytes32 version);

    /**
     * add versioned value for the given id
     */
    function addVersion(bytes32 id, bytes32 version, string calldata value) external onlyOwner {
        require(id != bytes32(0), "missing id");
        require(version != bytes32(0), "missing version");
        require(bytes(values[id][version].value).length == 0, "version already set");
        values[id][version].time = uint64(block.timestamp);
        values[id][version].version = version;
        values[id][version].value = value;
        bytes32 lastVersion = idToVersion[id];
        idToVersion[id] = version;
        versionHistory[id][version] = lastVersion;
        emit VersionAdded(id, version, value);
    }

    function cancelVersion(bytes32 id, bytes32 version) external onlyOwner {
        require(values[id][version].time != 0, "cancelVersion: no such version for id");
        require(!values[id][version].canceled, "cancelVersion: already canceled");
        values[id][version].canceled = true;
        emit VersionCanceled(id, version);
    }

    function getAllVersions(bytes32 id, uint maxVersions) external view returns (uint count, VersionInfo[] memory ret) {
        ret = new VersionInfo[](maxVersions);
        count = 0;
        bytes32 ver = idToVersion[id];

        while (ver != bytes32(0) && count < maxVersions) {
            ret[count++] = values[id][ver];
            ver = versionHistory[id][ver];
        }
    }

    function getVersion(bytes32 id, bytes32 optInVersion, uint maxAge) external view returns (VersionInfo memory) {
        bytes32 ver = idToVersion[id];
        while (ver != bytes32(0)) {
            VersionInfo storage v = values[id][ver];
            ver = versionHistory[id][ver];
            if (v.canceled)
                continue;
            if (v.time < block.timestamp - maxAge) {
                return v;
            }
            if (v.version == optInVersion) {
                return v;
            }
        }
        revert("no version found");
    }
}
