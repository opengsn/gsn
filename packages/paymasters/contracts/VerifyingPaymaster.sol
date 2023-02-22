//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/BasePaymaster.sol";
import "@opengsn/contracts/src/forwarder/IForwarder.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * a sample paymaster that requires an external signature on the request.
 * - the client creates a request.
 * - the client uses a RelayProvider with a callback function asyncApprovalData
 * - the callback sends the request over to a dapp-specific web service, to verify the request.
 * - the service verifies the request, signs it and return the signature.
 * - the client now sends this signed approval as the "approvalData" field of the GSN request.
 * - the paymaster verifies the signature.
 * This way, any external logic can be used to validate the request.
 * e.g.:
 * - OAuth, or any other login mechanism.
 * - Captcha approval
 * - off-chain payment system (note that its a payment for gas, so probably it doesn't require any KYC)
 * - etc.
 */
contract VerifyingPaymaster is Ownable, BasePaymaster {
    address private constant DRY_RUN_ADDRESS = 0x0000000000000000000000000000000000000000;

    address public signer;

    function _verifyApprovalData(bytes calldata approvalData) internal virtual override view {
        // solhint-disable-next-line avoid-tx-origin
        if (tx.origin != DRY_RUN_ADDRESS) {
            // solhint-disable-next-line reason-string
            require(approvalData.length == 65, "approvalData: invalid length for signature");
        }
    }

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    virtual
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (signature, maxPossibleGas);

        bytes32 requestHash = getRequestHash(relayRequest);
        // solhint-disable-next-line avoid-tx-origin
        if (tx.origin != DRY_RUN_ADDRESS) {
            require(signer == ECDSA.recover(requestHash, approvalData), "approvalData: wrong signature");
        }
        return ("", false);
    }

    function getRequestHash(GsnTypes.RelayRequest calldata relayRequest) public pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                packForwardRequest(relayRequest.request),
                packRelayData(relayRequest.relayData)
            )
        );
    }

    function packForwardRequest(IForwarder.ForwardRequest calldata req) public pure returns (bytes memory) {
        return abi.encode(req.from, req.to, req.value, req.gas, req.nonce, req.data);
    }

    function packRelayData(GsnTypes.RelayData calldata d) public pure returns (bytes memory) {
        return abi.encode(d.maxFeePerGas, d.maxPriorityFeePerGas, d.relayWorker, d.paymaster, d.paymasterData, d.clientId);
    }

    function _postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal
    override
    virtual {
        (context, success, gasUseWithoutPost, relayData);
    }

    function versionPaymaster() external view override virtual returns (string memory){
        return "3.0.0-beta.3+opengsn.vpm.ipaymaster";
    }

    function setSigner(address _signer) public onlyOwner {
        signer = _signer;
    }
}
