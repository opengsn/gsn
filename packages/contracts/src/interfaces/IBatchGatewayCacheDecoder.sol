// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../bls/utils/BLSTypes.sol";
import "./ICacheDecoder.sol";

interface IBatchGatewayCacheDecoder is ICacheDecoder{
    function decodeBatch(
        bytes calldata encodedBatch
    )
    external
    returns (
        BLSTypes.Batch memory decodedBatch
    );
}
