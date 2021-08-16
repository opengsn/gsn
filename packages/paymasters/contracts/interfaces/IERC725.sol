//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC725 {
    event DataChanged(bytes32 indexed key, bytes indexed value);
    event OwnerChanged(address indexed ownerAddress);
    event ContractCreated(address indexed contractAddress);

    function owner() external view returns (address);

    function changeOwner(address _owner) external;

    function getData(bytes32 _key) external view returns (bytes memory _value);

    function setData(bytes32 _key, bytes calldata _value) external;

    function execute(uint256 _operationType, address _to, uint256 _value, bytes calldata _data) external payable;
}
