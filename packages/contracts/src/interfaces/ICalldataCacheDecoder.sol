// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "./ICacheDecoder.sol";

interface ICalldataCacheDecoder is ICacheDecoder {
    /// A function that will both decode the data if it is passed as an ID or store it on-chain if the value is new
    /// @param encodedCalldata - an input that has to be properly decoded
    function decodeCalldata(
        bytes memory encodedCalldata
    )
    external
    returns (
        bytes memory
    );
}
