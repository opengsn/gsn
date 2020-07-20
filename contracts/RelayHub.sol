/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable avoid-tx-origin */
/* solhint-disable bracket-align */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.9;
pragma experimental ABIEncoderV2;

import "./0x/LibBytesV06.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./utils/GsnUtils.sol";
import "./utils/GsnEip712Library.sol";
import "./interfaces/GsnTypes.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPaymaster.sol";
import "./forwarder/IForwarder.sol";
import "./interfaces/IStakeManager.sol";

contract RelayHub is IRelayHub {

    string public override versionHub = "2.0.0-alpha.3+opengsn.hub.irelayhub";

    uint256 public override minimumStake;
    uint256 public override minimumUnstakeDelay;
    uint256 public override maximumRecipientDeposit;
    uint256 public override gasOverhead;
    uint256 public override postOverhead;
    uint256 public override gasReserve;
    uint256 public override maxWorkerCount;
    IStakeManager override public stakeManager;
    address override public penalizer;

    // maps relay worker's address to its manager's address
    mapping(address => address) public workerToManager;

    // maps relay managers to the number of their workers
    mapping(address => uint256) public workerCount;

    mapping(address => uint256) private balances;

    constructor (
        IStakeManager _stakeManager,
        address _penalizer,
        uint256 _maxWorkerCount,
        uint256 _gasReserve,
        uint256 _postOverhead,
        uint256 _gasOverhead,
        uint256 _maximumRecipientDeposit,
        uint256 _minimumUnstakeDelay,
        uint256 _minimumStake
    ) public {
        stakeManager = _stakeManager;
        penalizer = _penalizer;
        maxWorkerCount = _maxWorkerCount;
        gasReserve = _gasReserve;
        postOverhead = _postOverhead;
        gasOverhead = _gasOverhead;
        maximumRecipientDeposit = _maximumRecipientDeposit;
        minimumUnstakeDelay = _minimumUnstakeDelay;
        minimumStake =  _minimumStake;
    }

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external override {
        address relayManager = msg.sender;
        require(
            stakeManager.isRelayManagerStaked(relayManager, minimumStake, minimumUnstakeDelay),
            "relay manager not staked"
        );
        require(workerCount[relayManager] > 0, "no relay workers");
        emit RelayServerRegistered(relayManager, baseRelayFee, pctRelayFee, url);
    }

    function addRelayWorkers(address[] calldata newRelayWorkers) external override {
        address relayManager = msg.sender;
        workerCount[relayManager] = workerCount[relayManager] + newRelayWorkers.length;
        require(workerCount[relayManager] <= maxWorkerCount, "too many workers");

        require(
            stakeManager.isRelayManagerStaked(relayManager, minimumStake, minimumUnstakeDelay),
            "relay manager not staked"
        );

        for (uint256 i = 0; i < newRelayWorkers.length; i++) {
            require(workerToManager[newRelayWorkers[i]] == address(0), "this worker has a manager");
            workerToManager[newRelayWorkers[i]] = relayManager;
        }

        emit RelayWorkersAdded(relayManager, newRelayWorkers, workerCount[relayManager]);
    }

    function depositFor(address target) public override payable {
        uint256 amount = msg.value;
        require(amount <= maximumRecipientDeposit, "deposit too big");

        balances[target] = SafeMath.add(balances[target], amount);

        emit Deposited(target, msg.sender, amount);
    }

    function balanceOf(address target) external override view returns (uint256) {
        return balances[target];
    }

    function withdraw(uint256 amount, address payable dest) public override {
        address payable account = msg.sender;
        require(balances[account] >= amount, "insufficient funds");

        balances[account] -= amount;
        dest.transfer(amount);

        emit Withdrawn(account, dest, amount);
    }

    function canRelay(
        GsnTypes.RelayRequest calldata relayRequest,
        uint256 initialGas,
        bytes calldata signature,
        bytes calldata approvalData
    )
    private
    view
    returns (bool success, bytes memory returnValue, IPaymaster.GasLimits memory gasLimits)
    {
        gasLimits =
            IPaymaster(relayRequest.relayData.paymaster).getGasLimits();
        uint256 maxPossibleGas =
            gasOverhead +
            gasLimits.acceptRelayedCallGasLimit +
            gasLimits.preRelayedCallGasLimit +
            gasLimits.postRelayedCallGasLimit +
            relayRequest.request.gas;

        // This transaction must have enough gas to forward the call to the recipient with the requested amount, and not
        // run out of gas later in this function.
        require(
            initialGas >= maxPossibleGas,
            "Not enough gas left for innerRelayCall to complete");

        uint256 maxPossibleCharge = calculateCharge(
            maxPossibleGas,
            relayRequest.relayData
        );

        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(maxPossibleCharge <= balances[relayRequest.relayData.paymaster],
            "Paymaster balance too low");
        bytes memory encodedTx = abi.encodeWithSelector(IPaymaster.acceptRelayedCall.selector,
            relayRequest, signature, approvalData, maxPossibleGas
        );

        (success, returnValue) =
            relayRequest.relayData.paymaster.staticcall{gas:gasLimits.acceptRelayedCallGasLimit}(encodedTx);
    }

    struct RelayCallData {
        bool success;
        bytes4 functionSelector;
        bytes recipientContext;
        bytes relayedCallReturnValue;
        IPaymaster.GasLimits gasLimits;
        RelayCallStatus status;
    }

    function relayCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint externalGasLimit
    )
    external
    override
    returns (bool paymasterAccepted, string memory revertReason)
    {
        RelayCallData memory vars;
        vars.functionSelector = LibBytesV06.readBytes4(relayRequest.request.data, 0);
        require(msg.sender == tx.origin, "relay worker cannot be a smart contract");
        require(workerToManager[msg.sender] != address(0), "Unknown relay worker");
        require(relayRequest.relayData.relayWorker == msg.sender, "Not a right worker");
        require(
            stakeManager.isRelayManagerStaked(workerToManager[msg.sender], minimumStake, minimumUnstakeDelay),
            "relay manager not staked"
        );
        require(relayRequest.relayData.gasPrice <= tx.gasprice, "Invalid gas price");
        require(externalGasLimit <= block.gaslimit, "Impossible gas limit");

        // We now verify that the paymaster will agree to be charged for the transaction.
        (vars.success, vars.recipientContext, vars.gasLimits) =
            canRelay(relayRequest,
                    externalGasLimit, signature, approvalData);

        if (!vars.success) {
            revertReason = GsnUtils.getError(vars.recipientContext);
            emit TransactionRejectedByPaymaster(
                workerToManager[msg.sender],
                relayRequest.relayData.paymaster,
                relayRequest.request.from,
                relayRequest.request.to,
                msg.sender,
                vars.functionSelector,
                revertReason);
            return (vars.success, revertReason);
        }

        // From this point on, this transaction will not revert nor run out of gas, and the paymaster will be charged
        // for the gas spent.

    {
        //How much gas to pass down to innerRelayCall. must be lower than the default 63/64
        // actually, min(gasleft*63/64, gasleft-GAS_RESERVE) might be enough.
        uint innerGasLimit = gasleft()*63/64-gasReserve;

        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        (, bytes memory relayCallStatus) = address(this).call{gas:innerGasLimit}(
            abi.encodeWithSelector(RelayHub.innerRelayCall.selector, relayRequest, signature, vars.gasLimits,
                innerGasLimit + externalGasLimit-gasleft() + gasOverhead + postOverhead, /*totalInitialGas*/
                abi.decode(vars.recipientContext, (bytes)))
        );
        (vars.status, vars.relayedCallReturnValue) = abi.decode(relayCallStatus, (RelayCallStatus, bytes));
    }
    {
        // We now perform the actual charge calculation, based on the measured gas used
        uint256 gasUsed = (externalGasLimit - gasleft()) + gasOverhead;
        uint256 charge = calculateCharge(gasUsed, relayRequest.relayData);

        // We've already checked that the paymaster has enough balance to pay for the relayed transaction, this is only
        // a sanity check to prevent overflows in case of bugs.
        require(balances[relayRequest.relayData.paymaster] >= charge, "Should not get here");
        balances[relayRequest.relayData.paymaster] -= charge;
        balances[workerToManager[msg.sender]] += charge;

        emit TransactionRelayed(
            workerToManager[msg.sender],
            msg.sender,
            relayRequest.request.from,
            relayRequest.request.to,
            relayRequest.relayData.paymaster,
            vars.functionSelector,
            vars.status,
            vars.relayedCallReturnValue,
            charge);
        return (true, "");
    }
    }

    struct AtomicData {
        uint256 balanceBefore;
        bytes32 preReturnValue;
        bool relayedCallSuccess;
        bytes relayedCallReturnValue;
        bytes data;
    }

    function innerRelayCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        IPaymaster.GasLimits calldata gasLimits,
        uint256 totalInitialGas,
        bytes calldata recipientContext
    )
    external
    returns (RelayCallStatus, bytes memory)
    {
        AtomicData memory atomicData;
        // A new gas measurement is performed inside innerRelayCall, since
        // due to EIP150 available gas amounts cannot be directly compared across external calls

        // This external function can only be called by RelayHub itself, creating an internal transaction. Calls to the
        // recipient (preRelayedCall, the relayedCall, and postRelayedCall) are called from inside this transaction.
        require(msg.sender == address(this), "Only RelayHub should call this function");

        // If either pre or post reverts, the whole internal transaction will be reverted, reverting all side effects on
        // the recipient. The recipient will still be charged for the used gas by the relay.

        // The recipient is no allowed to withdraw balance from RelayHub during a relayed transaction. We check pre and
        // post state to ensure this doesn't happen.
        atomicData.balanceBefore = balances[relayRequest.relayData.paymaster];

        // First preRelayedCall is executed.
        // Note: we open a new block to avoid growing the stack too much.
        atomicData.data = abi.encodeWithSelector(
            IPaymaster.preRelayedCall.selector, recipientContext
        );
        {
            bool success;
            bytes memory retData;
            // preRelayedCall may revert, but the recipient will still be charged: it should ensure in
            // acceptRelayedCall that this will not happen.
            (success, retData) = relayRequest.relayData.paymaster.call{gas:gasLimits.preRelayedCallGasLimit}(atomicData.data);
            if (!success) {
                revertWithStatus(RelayCallStatus.PreRelayedFailed, GsnEip712Library.getTruncatedData(retData));
            }
            atomicData.preReturnValue = abi.decode(retData, (bytes32));
        }

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data
        (atomicData.relayedCallSuccess, atomicData.relayedCallReturnValue) = GsnEip712Library.execute(relayRequest, signature);

        // Finally, postRelayedCall is executed, with the relayedCall execution's status and a charge estimate
        // We now determine how much the recipient will be charged, to pass this value to postRelayedCall for accurate
        // accounting.
        atomicData.data = abi.encodeWithSelector(
            IPaymaster.postRelayedCall.selector,
            recipientContext,
            atomicData.relayedCallSuccess,
            atomicData.preReturnValue,
            totalInitialGas - gasleft(), /*gasUseWithoutPost*/
            relayRequest.relayData
        );

        (bool successPost,) = relayRequest.relayData.paymaster.call{gas:gasLimits.postRelayedCallGasLimit}(atomicData.data);

        if (!successPost) {
            revertWithStatus(RelayCallStatus.PostRelayedFailed, atomicData.relayedCallReturnValue);
        }

        if (balances[relayRequest.relayData.paymaster] < atomicData.balanceBefore) {
            revertWithStatus(RelayCallStatus.RecipientBalanceChanged, atomicData.relayedCallReturnValue);
        }

        return (atomicData.relayedCallSuccess ? RelayCallStatus.OK : RelayCallStatus.RelayedCallFailed, atomicData.relayedCallReturnValue);
    }

    /**
     * @dev Reverts the transaction with return data set to the ABI encoding of the status argument.
     */
    function revertWithStatus(RelayCallStatus status, bytes memory ret) private pure {
        bytes memory data = abi.encode(status, ret);

        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            revert(dataPtr, dataSize)
        }
    }

    function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) public override virtual view returns (uint256) {
        return relayData.baseRelayFee + (gasUsed * relayData.gasPrice * (100 + relayData.pctRelayFee)) / 100;
    }

    modifier penalizerOnly () {
        require(msg.sender == penalizer, "Not penalizer");
        _;
    }

    function penalize(address relayWorker, address payable beneficiary) external override penalizerOnly {
        address relayManager = workerToManager[relayWorker];
        // The worker must be controlled by a manager with a locked stake
        require(relayManager != address(0), "Unknown relay worker");
        require(
            stakeManager.isRelayManagerStaked(relayManager, minimumStake, minimumUnstakeDelay),
            "relay manager not staked"
        );
        IStakeManager.StakeInfo memory stakeInfo = stakeManager.getStakeInfo(relayManager);
        stakeManager.penalizeRelayManager(relayManager, beneficiary, stakeInfo.stake);
    }
}
