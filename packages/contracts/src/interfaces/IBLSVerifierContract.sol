// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

interface IBLSVerifierContract {
    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        uint256[2] memory message
    ) external view returns (bool);


    function verifyMultiple(
        uint256[2] memory signature,
        uint256[4][] memory pubkeys,
        uint256[2][] memory messages
    ) external view returns (bool);
}
