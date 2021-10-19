// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../interfaces/IERC20CacheDecoder.sol";

import "../utils/GsnTypes.sol";
import "../utils/RLPReader.sol";

import "./utils/BLSTypes.sol";
import "./utils/CacheLibrary.sol";

/**
*
*/
contract ERC20CacheDecoder is IERC20CacheDecoder {
    using RLPReader for bytes;
    using RLPReader for uint;
    using RLPReader for RLPReader.RLPItem;
    using CacheLibrary for BLSTypes.AddressCache;

    enum ERC20Method {
        Transfer,
        TransferFrom,
        Approve,
        Mint,
        Burn,
        Permit
    }
    bytes4[] public methodIds = [
    bytes4(0xa9059cbb),
    bytes4(0x23b872dd),
    bytes4(0x095ea7b3),
    bytes4(0x00000000),
    bytes4(0x00000000),
    bytes4(0xd505accf)
    ];

    // method-specific parameters
    BLSTypes.AddressCache private recipientsCache;

    /// Decodes the input and stores the values that are encountered for the first time.
    /// @return decoded the array with all values filled either from input of from the cache
    function decodeCalldata(
        bytes memory encodedCalldata
    )
    public
    override
    returns (
        bytes memory
    ){
        RLPReader.RLPItem[] memory values = encodedCalldata.toRlpItem().toList();
        uint256 methodSignatureId = values[0].toUint();
        bytes4 methodSignature = methodIds[methodSignatureId];

        if (methodSignature == methodIds[uint256(ERC20Method.Transfer)] ||
            methodSignature == methodIds[uint256(ERC20Method.Approve)]) {
            uint256 recipientId = values[1].toUint();
            uint256 value = values[2].toUint();
            address recipient = recipientsCache.queryAndUpdateCache(recipientId);
            return abi.encodeWithSelector(methodSignature, recipient, value);
        } else if (methodSignature == methodIds[uint256(ERC20Method.TransferFrom)]) {
            uint256 ownerId = values[1].toUint();
            uint256 recipientId = values[2].toUint();
            uint256 value = values[3].toUint();
            address owner = recipientsCache.queryAndUpdateCache(ownerId);
            address recipient = recipientsCache.queryAndUpdateCache(recipientId);
            return abi.encodeWithSelector(methodSignature, owner, recipient, value);
        } else if (methodSignature == methodIds[uint256(ERC20Method.Burn)]) {
            uint256 value = values[1].toUint();
            return abi.encodeWithSelector(methodSignature, value);
        }
        revert("unknown ERC20 method ID");
    }

    function convertAddressesToIds(
        address[] memory recipients
    )
    external
    override
    view
    returns (
        uint256[] memory sendersID
    ){
        return recipientsCache.convertAddressesToIdsInternal(recipients);
    }

}
