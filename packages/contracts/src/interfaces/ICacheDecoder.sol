// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../utils/GsnTypes.sol";

interface ICacheDecoder {
    /// A view function for the clients to query IDs of cached values from the chain
    /// @param words - an array of inputs converted to words and grouped by their type if cached separately
    function convertWordsToIds(
        uint256[][] memory words
    )
    external
    view
    returns (
        uint256[][] memory
    );
}
