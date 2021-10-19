// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../utils/GsnTypes.sol";

interface IERC20CacheDecoder {
    function decodeCalldata(
        bytes memory encodedCalldata
    )
    external
    returns (
        bytes memory
    );

    function convertAddressesToIds(
        address[] memory recipients
    )
    external
    view
    returns (
        uint256[] memory sendersID
    );
}
