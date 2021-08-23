/* solhint-disable no-inline-assembly */
// SPDX-License-Identifier:MIT

pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@opengsn/contracts/src/BaseRelayRecipient.sol";

import "../interfaces/IERC725.sol";

contract ProxyIdentity is IERC725, BaseRelayRecipient, Initializable {
    string public override versionRecipient = "2.2.3+opengsn.erc725.irelayrecipient";

    uint256 private constant OPERATION_CALL = 0;
    uint256 private constant OPERATION_CREATE = 1;

    address public override owner;

    mapping(bytes32 => bytes) override public getData;

    // solhint-disable-next-line no-empty-blocks
    receive () external payable {}

    constructor(address _owner) {
        owner = _owner;
    }

    function initialize(address _trustedForwarder, IERC20[] calldata tokens) external initializer {
        _setTrustedForwarder(_trustedForwarder);
        for (uint256 i =0; i < tokens.length; i++){
            tokens[i].approve(address(msg.sender), type(uint).max);
        }
    }

    modifier onlyOwner() {
        require(_msgSender() == owner, "ProxyIdentity: caller not owner");
        _;
    }

    function changeOwner(address)
        external
        view
        override
        onlyOwner
    {
        revert("not supported");
        /*
        owner = _owner;
        emit OwnerChanged(owner);
        */
    }

    function setData(bytes32, bytes calldata)
    external
    view
    override
    onlyOwner
    {
        revert("not supported");
        /*
        getData[_key] = _value;
        emit DataChanged(_key, _value);
        */
    }

    function execute(uint256 _operationType, address _to, uint256 _value, bytes calldata _data)
        external
        payable
        override
        onlyOwner
    {
        if (_operationType == OPERATION_CALL) {
            require(executeCall(_to, _value, _data), "executeCall failed");
        } else if (_operationType == OPERATION_CREATE) {
            address newContract = executeCreate(_data);
            emit ContractCreated(newContract);
        } else {
            revert("not supported");
        }
    }

    function executeCall(address to, uint256 value, bytes memory data)
        internal
        returns (bool success)
    {
        // solhint-disable-next-line avoid-low-level-calls
        (success,) = to.call{value: value}(data);
    }

    function executeCreate(bytes memory)
        internal
        pure
        returns (address /*newContract*/)
    {
        revert("not supported");
    /*
        assembly {
            newContract := create(0, add(data, 0x20), mload(data))
        }
    */
    }
}
