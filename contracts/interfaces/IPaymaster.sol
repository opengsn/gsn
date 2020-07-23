// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";

interface IPaymaster {

    struct GasLimits {
        //paymaster is committed to pay reverted transactions above this gas limit.
        // This limit should cover both preRelayedCall gaslimit AND forwrader's nonce and signature validation.
        uint256 commitmentGasLimit;
        uint256 preRelayedCallGasLimit;
        uint256 postRelayedCallGasLimit;
    }

    /**
     * return the relayHub of this contract.
     */
    function getHubAddr() external view returns (address);

    /**
     * Can be used to determine if the contract can pay for incoming calls before making any.
     * @return the paymaster's deposit in the RelayHub.
     */
    function getRelayHubDeposit() external view returns (uint256);

    /**
     * The RelayHub will call accept-, pre-, and post-, RelayCall methods with these values for their gas limits.
     */
    function getGasLimits()
    external
    view
    returns (
        GasLimits memory limits
    );

    /**
     * Called by Relay (and RelayHub), to validate if the paymaster accepts paying this call.
     * revert to signal the paymaster will NOT pay for this call.
     *
     * MUST be protected with relayHubOnly() in case it modifies state.
     *
     * Note that revert by the Forwrader (either on nonce or signature) will also reject the call.
     * a paymaster may also set "revertOnRecipientRevert" to signal that revert by the recipient
     * contract should also be rejected. In this case, it means the Paymaster trust the recipient
     * to reject fast: both preRelayedCall, forwarder check and receipient checks must fit into
     * the GasLimits.commitmentGasLimit, otherwise the TX is paid by the Paymaster.
     *  @param relayRequest - the full relay request structure
     *  @param approvalData - extra dapp-specific data (e.g. signature from trusted party)
     *  @param maxPossibleGas - based on values returned from {@link getGasLimits},
     *         the RelayHub will calculate the maximum possible amount of gas the user may be charged for.
     *         In order to convert this value to wei, the Paymaster has to call "relayHub.calculateCharge()"
     *  return:
     *      a context to be passed to postRelayedCall
     *      revertOnRecipientRevert - TRUE if paymaster want to reject the TX if the recipient reverts.
     *          FALSE means that rejects by the recipient will be completed on chain, and paid by the paymaster.
     *          (note that in this case, the preRelayedCall and postRelayedCall are not reverted).
     */
    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    returns (bytes memory context, bool revertOnRecipientRevert);

    /**
     * This method is called after the actual relayed function call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     *
     * MUST be protected with relayHubOnly() in case it modifies state.
     *
     * @param context - the call context, as returned by the preRelayedCall
     * @param success - true if the relayed call succeeded, false if it reverted
     * @param gasUseWithoutPost - the actual amount of gas used by the entire transaction, EXCEPT
     *        the gas used by the postRelayedCall itself.
     * @param relayData - the relay params of the request. can be used by relayHub.calculateCharge()
     *
     * Revert in this functions causes a revert of the client's relayed call (and preRelayedCall(), but the Paymaster
     * is still committed to pay the relay for the entire transaction.
     */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external;

    function versionPaymaster() external view returns (string memory);
}
