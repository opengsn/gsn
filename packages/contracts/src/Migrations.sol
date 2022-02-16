// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

contract Migrations {
    address public owner;
    // solhint-disable-next-line var-name-mixedcase
    uint256 public last_completed_migration;

    constructor() {
        owner = msg.sender;
    }

    modifier restricted() {
        if (msg.sender == owner) _;
    }

    function setCompleted(uint256 completed) public restricted {
        last_completed_migration = completed;
    }

    function upgrade(address newAddress) public restricted {
        Migrations upgraded = Migrations(newAddress);
        upgraded.setCompleted(last_completed_migration);
    }
}
