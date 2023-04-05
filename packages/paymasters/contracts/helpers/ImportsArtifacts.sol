//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

//"import" it into our project for Truffle to generate artifacts
import "@opengsn/contracts/src/forwarder/IForwarder.sol";
import "@opengsn/contracts/src/forwarder/Forwarder.sol";
import "@opengsn/contracts/src/StakeManager.sol";
import "@opengsn/contracts/src/Penalizer.sol";
import "@opengsn/contracts/src/utils/RelayRegistrar.sol";
import "@opengsn/contracts/src/test/TestRecipient.sol";

import "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
