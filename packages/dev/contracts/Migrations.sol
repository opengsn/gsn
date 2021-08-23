// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@opengsn/contracts/src/RelayHub.sol";
import "@opengsn/contracts/src/StakeManager.sol";
import "@opengsn/contracts/src/Penalizer.sol";
import "@opengsn/contracts/src/BatchForwarder.sol";

import "@opengsn/contracts/src/test/PayableWithEmit.sol";
import "@opengsn/contracts/src/test/TestPaymasterConfigurableMisbehavior.sol";
import "@opengsn/contracts/src/test/TestPaymasterEverythingAccepted.sol";
import "@opengsn/contracts/src/test/PayableWithEmit.sol";
import "@opengsn/contracts/src/test/TestPaymasterOwnerSignature.sol";
import "@opengsn/contracts/src/test/TestPaymasterPreconfiguredApproval.sol";
import "@opengsn/contracts/src/test/TestPaymasterStoreContext.sol";
import "@opengsn/contracts/src/test/TestPaymasterVariableGasLimits.sol";
import "@opengsn/contracts/src/test/TestRecipient.sol";
import "@opengsn/contracts/src/test/TestRelayHubValidator.sol";
import "@opengsn/contracts/src/test/TestRelayWorkerContract.sol";
import "@opengsn/contracts/src/test/TestUtil.sol";

import "@opengsn/contracts/src/utils/GsnEip712Library.sol";
import "@opengsn/contracts/src/utils/GsnUtils.sol";
import "@opengsn/contracts/src/utils/MinLibBytes.sol";
import "@opengsn/contracts/src/utils/RLPReader.sol";
import "@opengsn/contracts/src/utils/VersionRegistry.sol";

import "@opengsn/contracts/src/forwarder/Forwarder.sol";
import "@opengsn/contracts/src/forwarder/test/TestForwarder.sol";
import "@opengsn/contracts/src/forwarder/test/TestForwarderTarget.sol";

contract Migrations {
    address public owner;
    // solhint-disable-next-line var-name-mixedcase
    uint public last_completed_migration;

    constructor() {
        owner = msg.sender;
    }

    modifier restricted() {
        if (msg.sender == owner) _;
    }

    function setCompleted(uint completed) public restricted {
        last_completed_migration = completed;
    }

    function upgrade(address newAddress) public restricted {
        Migrations upgraded = Migrations(newAddress);
        upgraded.setCompleted(last_completed_migration);
    }
}
