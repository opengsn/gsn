// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

interface IVersionOracle {

    //struct defining a single version entry
    struct VersionInfo {
        uint64 time;
        bool canceled;
        bytes32 version;
        string value;
    }

    //event emitted whenever a version is added
    event VersionAdded(bytes32 indexed id, bytes32 version, string value);

    //event emitted whenever a version is canceled
    event VersionCanceled(bytes32 indexed id, bytes32 version);

    /**
     * add a version
     * @param id the object-id to add a version (32-byte string)
     * @param version the new version to add (32-byte string)
     * @param value value to attach to this version
     */
    function addVersion(bytes32 id, bytes32 version, string calldata value) external;

    /**
     * cancel a version.
     */
    function cancelVersion(bytes32 id, bytes32 version) external;

    /**
     * return all (up to maxVersions) version entries from the registry for the given id, in reverse order
     * (latest to earliest)
     * @param id the id to get the version for.
     * @param maxVersions the size of the returned array. up to that many entries can be returned.
     * returns: count number of returned entries. if count==maxVersions, it is quite possible there are more versions,
     *  so a new call should be attempted, with higher maxVersions.
     *  ret array of VersionInfo
     */
    function getAllVersions(bytes32 id, uint maxVersions) external view returns (uint count, VersionInfo[] memory ret);

    /**
     * return actual version to use.
     * @param id the id to get the version for.
     * @param delayPeriod - don't return entries added during the delayPeriod.
     * @param optInVersion - override delayPeriod: return this entry even if it is within the delayPeriod (but not canceled)
     * NOTE: in any case, "canceled" versions are never returned
     * reverts if no entry can be returned (no versions, or all canceled or within the delayPeriod
     */
    function getVersion(bytes32 id, bytes32 optInVersion, uint delayPeriod) external view returns (VersionInfo memory);
}
