// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/IBLSVerifierContract.sol";

import "./utils/BLS.sol";

contract BLSVerifierContract is IBLSVerifierContract{
    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        uint256[2] memory message
    ) external override view returns (bool) {
        return BLS.verifySingle(signature, pubkey, message);
    }


    function verifyMultiple(
        uint256[2] memory signature,
        uint256[4][] memory pubkeys,
        uint256[2][] memory messages
    ) external override view returns (bool) {
        return BLS.verifyMultiple(signature, pubkeys, messages);
    }
}
