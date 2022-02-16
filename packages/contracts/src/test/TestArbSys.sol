// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../arbitrum/ArbSys.sol";

/**
* As there is no way to run Arbitrum chain locally, tests currently need to run on simple hardhat node.
* If some behavior is needed from ArbSys, it has to be stubbed here.
 */
contract TestArbSys is ArbSys {

    /**
    * @notice Get Arbitrum block number (distinct from L1 block number; Arbitrum genesis block has block number 0)
    * @return block number as int
     */
    function arbBlockNumber() external override view returns (uint){
        return block.number * 17;
    }

    function getStorageGasAvailable() external override view returns (uint256) {
        // we need some really large value as for gasleft but also one that does decrease on every call
        return gasleft() * 100;
    }
}
