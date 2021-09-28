// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "./BLSTypes.sol";

// To be imported from https://github.com/kilic/evmbls
library BLS {
    function verifyMultiple(
        uint256[2] memory signature,
        BLSTypes.BLSPublicKey[] memory pubkeys,
        uint256[2][] memory messages
    ) internal pure returns (bool) {

        uint256 size = pubkeys.length;
        require(size > 0, "BLS: number of public key is zero");
        require(size == messages.length, "BLS: number of public keys and messages must be equal");

        return true;
    }

    function hashToPoint(bytes memory domain, bytes memory message) internal view returns (uint256[2] memory) {
        return [uint256(1), uint256(2)];
    }
}
