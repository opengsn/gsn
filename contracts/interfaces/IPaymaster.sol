// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./GsnTypes.sol";

interface IPaymaster {

    struct GasLimits {
        uint256 acceptRelayedCallGasLimit;
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
     *  @param relayRequest - the full relay request structure
     *  @param signature - user's EIP712-compatible signature of the {@link relayRequest}
     *  @param approvalData - extra dapp-specific data (e.g. signature from trusted party)
     *  @param maxPossibleGas - based on values returned from {@link getGasLimits},
     *         the RelayHub will calculate the maximum possible amount of gas the user may be charged for.
     *         In order to convert this value to wei, the Paymaster has to call "relayHub.calculateCharge()"
     *  @return a context to be passed to preRelayedCall and postRelayedCall.
     */
    function acceptRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    view
    returns (bytes memory);

    /** this method is called before the actual relayed function call.
     * It may be used to charge the caller before
     * (in conjunction with refunding him later in postRelayedCall for example).
     * the method is given all parameters of acceptRelayedCall and actual used gas.
     *
     *
     * NOTICE: if this method modifies the contract's state, it must be
     * protected with access control i.e. require msg.sender == getHubAddr()
     *
     *
     * Revert in this functions causes a revert of the client's relayed call but not in the entire transaction
     * (that is, the relay will still get compensated)
     */
    function preRelayedCall(bytes calldata context) external returns (bytes32);

    /**
     * This method is called after the actual relayed function call.
     * It may be used to record the transaction (e.g. charge the caller by some contract logic) for this call.
     * the method is given all parameters of acceptRelayedCall, and also the success/failure status and actual used gas.
     *
     *
     * NOTICE: if this method modifies the contract's state,
     * it must be protected with access control i.e. require msg.sender == getHubAddr()
     *
     *
     * @param success - true if the relayed call succeeded, false if it reverted
     * @param gasUseWithoutPost - the actual amount of gas used by the entire transaction.
              Does not included any estimate of how much gas PostRelayCall itself will consume.
              NOTE: The gas overhead estimation is included in this number.
     * @param preRetVal - preRelayedCall() return value passed back to the recipient
     *
     * Revert in this functions causes a revert of the client's relayed call but not in the entire transaction
     * (that is, the relay will still get compensated)
     */
    function postRelayedCall(
        bytes calldata context,
        bool success,
        bytes32 preRetVal,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external;

    function versionPaymaster() external view returns (string memory);
}
