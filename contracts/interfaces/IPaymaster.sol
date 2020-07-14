// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";

interface IPaymaster {

    struct GasLimits {
        //paymaster is commited to pay reverted transactions above this gas limit.
        // This limit includes both preRelayedCall gaslimit AND forwrader's nonce and signature validation.
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
     * Called by Relay (and RelayHub), to validate if this recipient accepts this call.
     * revert to signal the paymaster will NOT pay for this call.
     * Note: Accepting this call means paying for the tx whether the relayed call reverted or not.
     * Also, the call is rejected if the Forwarder reverts on recipient's nonce or signature errors.
     *  @param relayRequest - the full relay request structure
     *  @param approvalData - extra dapp-specific data (e.g. signature from trusted party)
     *  @param maxPossibleGas - based on values returned from {@link getGasLimits},
     *         the RelayHub will calculate the maximum possible amount of gas the user may be charged for.
     *         In order to convert this value to wei, the Paymaster has to call "relayHub.calculateCharge()"
     *  return:
     *      a context to be passed to postRelayedCall
     *      isTrustedRecipient - TRUE if paymaster want to reject the TX if the recipient reverts.
     *          This flag means the Paymaster trust the recipient to revert fast enough (within "commitment" gas limit)
     */
    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    returns (bytes memory context, bool isTrustedRecipient);

    /**
     * This method is called after the actual relayed function call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     * the method is given all parameters of acceptRelayedCall, and also the success/failure status and actual used gas.
     *
     * NOTICE: if this method modifies the contract's state,
     * it must be protected with access control i.e. require msg.sender == getHubAddr()
     *
     *
     * @param success - true if the relayed call succeeded, false if it reverted
     * @param gasUseWithoutPost - the actual amount of gas used by the entire transaction.
              Does not included any estimate of how much gas PostRelayCall itself will consume.
              NOTE: The gas overhead estimation is included in this number.
     *
     * Revert in this functions causes a revert of the client's relayed call but not in the entire transaction
     * (that is, the relay will still get compensated)
     */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external;

    function versionPaymaster() external view returns (string memory);
}
