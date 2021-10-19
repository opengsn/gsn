// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "../forwarder/IForwarder.sol";

// TODO: copy-paste is dangerous! Consider extracting a Forwarder library
// TODO 2: IForwarder interface defines exactly EIP-2771 Forwarder. Make a more generic FWD interface.
contract GatewayForwarder {

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    function _verifyAndUpdateNonce(IForwarder.ForwardRequest calldata req) internal {
        require(nonces[req.from]++ == req.nonce, "FWD: nonce mismatch");
    }

    function execute(
        IForwarder.ForwardRequest calldata req,
        bytes32,
        bytes32,
        bytes calldata,
        bytes calldata
    )
    external payable
//    override
    returns (bool success, bytes memory ret) {
        _verifyAndUpdateNonce(req);

        require(req.validUntil == 0 || req.validUntil > block.number, "FWD: request expired");

        uint gasForTransfer = 0;
        if ( req.value != 0 ) {
            gasForTransfer = 40000; //buffer in case we need to move eth after the transaction.
        }
        bytes memory callData = abi.encodePacked(req.data, req.from);
        require(gasleft()*63/64 >= req.gas + gasForTransfer, "FWD: insufficient gas");
        // solhint-disable-next-line avoid-low-level-calls
        (success,ret) = req.to.call{gas : req.gas, value : req.value}(callData);
        if ( req.value != 0 && address(this).balance>0 ) {
            // can't fail: req.from signed (off-chain) the request, so it must be an EOA...
            payable(req.from).transfer(address(this).balance);
        }

        return (success,ret);
    }
}
