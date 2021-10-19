// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../utils/GsnTypes.sol";

interface IBatchGatewayCacheDecoder {
    function convertAddressesToIds(
        address[] memory senders,
        address[] memory targets,
        address[] memory paymasters
    )
    external
    view
    returns (
        uint256[] memory sendersID,
        uint256[] memory targetsID,
        uint256[] memory paymastersID
    );
}
