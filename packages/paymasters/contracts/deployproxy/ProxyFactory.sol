//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";
import "./ProxyIdentity.sol";

contract  ProxyFactory {
    using Address for address;

    event ProxyDeployed(address proxyAddress);

    function calculateAddress(address owner) public view returns (address){
        return address(uint160(uint256(keccak256(
                abi.encodePacked(
                    uint8(0xff),
                    address(this),
                    bytes32(0),
                    keccak256(abi.encodePacked(type(ProxyIdentity).creationCode, abi.encode(owner)))
                )))));
    }

    function deployProxy(address owner) external returns (ProxyIdentity) {
        address calculatedAddress = calculateAddress(owner);
        if (!calculatedAddress.isContract()) {
            ProxyIdentity proxyIdentity = new ProxyIdentity{salt: 0}(owner);
            require(calculatedAddress == address(proxyIdentity), "FATAL: create2 wrong address");
            emit ProxyDeployed(calculatedAddress);
        }
        return ProxyIdentity(payable(calculatedAddress));
    }
}
