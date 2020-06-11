// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./Eip712Forwarder.sol";

contract Forwarder is Eip712Forwarder {
    function versionForwarder() external view virtual override returns (string memory){
        return "2.0.0-alpha.1+opengsn.forwarder.iforwarder";
    }
}
