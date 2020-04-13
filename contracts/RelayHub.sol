/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable bracket-align */
pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "./utils/EIP712Sig.sol";
import "./utils/GSNTypes.sol";
import "./utils/GsnUtils.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPaymaster.sol";
import "./interfaces/ITrustedForwarder.sol";
import "./BaseRelayRecipient.sol";
import "./StakeManager.sol";
import "./Penalizer.sol";

contract RelayHub is IRelayHub {

    string constant public COMMIT_ID = "$Id$";

    // Minimum stake a relay can have. An attack to the network will never cost less than half this value.
    uint256 constant private MINIMUM_STAKE = 1 ether;

    // Minimum unstake delay blocks of a relay manager's stake on the StakeManager
    uint256 constant private MINIMUM_UNSTAKE_DELAY = 1000;

    // Minimum balance required for a relay to register or re-register. Prevents user error in registering a relay that
    // will not be able to immediately start serving requests.
    uint256 constant private MINIMUM_RELAY_BALANCE = 0.1 ether;

    // Maximum funds that can be deposited at once. Prevents user error by disallowing large deposits.
    uint256 constant private MAXIMUM_RECIPIENT_DEPOSIT = 2 ether;

    /**
    * the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */

    // Gas cost of all relayCall() instructions after actual 'calculateCharge()'
    uint256 constant private GAS_OVERHEAD = 37770;

    function getHubOverhead() external view returns (uint256) {
        return GAS_OVERHEAD;
    }
    // Gas set aside for all relayCall() instructions to prevent unexpected out-of-gas exceptions
    uint256 constant private GAS_RESERVE = 100000;

    uint256 public gtxdatanonzero;
    uint256 constant public GTRANSACTION = 21000;

    enum AtomicRecipientCallsStatus {OK, CanRelayFailed, RelayedCallFailed, PreRelayedFailed, PostRelayedFailed}

    // maps relay worker's address to its manager's address
    mapping(address => address) private workerToManager;

    // maps relay managers to the number of their workers
    mapping(address => uint256) private workerCount;

    uint256 constant public MAX_WORKER_COUNT = 10;

    mapping(address => uint256) private balances;

    string public version = "1.0.0";
    // TODO: remove with 0.6 solc
    function getVersion() external view returns (string memory) {
        return version;
    }


    EIP712Sig public eip712sig;
    StakeManager public stakeManager;
    Penalizer public penalizer;
    constructor (uint256 _gtxdatanonzero, StakeManager _stakeManager, Penalizer _penalizer) public {
        eip712sig = new EIP712Sig(address(this));
        stakeManager = _stakeManager;
        penalizer = _penalizer;
        gtxdatanonzero = _gtxdatanonzero;
    }

    function getStakeManager() external view returns(address) {
        return address(stakeManager);
    }

    function calldatagascost() private view returns (uint256) {
        return GTRANSACTION + msg.data.length * gtxdatanonzero;
    }


    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external {
        address relayManager = msg.sender;
        require(
            stakeManager.isRelayManagerStaked(relayManager, MINIMUM_STAKE, MINIMUM_UNSTAKE_DELAY),
            "relay manager not staked"
        );
        require(workerCount[relayManager] > 0, "no relay workers");
        emit RelayServerRegistered(relayManager, baseRelayFee, pctRelayFee, url);
    }

    function addRelayWorkers(address[] calldata newRelayWorkers) external {
        address relayManager = msg.sender;
        workerCount[relayManager] = workerCount[relayManager] + newRelayWorkers.length;
        require(workerCount[relayManager] <= MAX_WORKER_COUNT, "too many workers");

        require(
            stakeManager.isRelayManagerStaked(relayManager, MINIMUM_STAKE, MINIMUM_UNSTAKE_DELAY),
            "relay manager not staked"
        );

        for (uint256 i = 0; i < newRelayWorkers.length; i++) {
            require(workerToManager[newRelayWorkers[i]] == address(0), "this worker has a manager");
            workerToManager[newRelayWorkers[i]] = relayManager;
        }

        emit RelayWorkersAdded(relayManager, newRelayWorkers, workerCount[relayManager]);
    }

    function depositFor(address target) public payable {
        uint256 amount = msg.value;
        require(amount <= MAXIMUM_RECIPIENT_DEPOSIT, "deposit too big");

        balances[target] = SafeMath.add(balances[target], amount);

        emit Deposited(target, msg.sender, amount);
    }

    function balanceOf(address target) external view returns (uint256) {
        return balances[target];
    }

    function withdraw(uint256 amount, address payable dest) public {
        address payable account = msg.sender;
        require(balances[account] >= amount, "insufficient funds");

        balances[account] -= amount;
        dest.transfer(amount);

        emit Withdrawn(account, dest, amount);
    }

    function canRelay(
        GSNTypes.RelayRequest memory relayRequest,
        uint256 maxPossibleGas,
        uint256 acceptRelayedCallGasLimit,
        bytes memory signature,
        bytes memory approvalData
    )
    public
    view
    returns (bool success, string memory returnValue)
    {
        bytes memory ret;
        (success, ret) = relayRequest.target.staticcall(abi.encodeWithSelector(
            BaseRelayRecipient(relayRequest.target).getTrustedForwarder.selector
        ));
        if (!success || ret.length != 32) {
            return (false, "getTrustedForwarder failed");
        }
        // Verify the sender's request: signature and nonce.
        ITrustedForwarder forwarder = ITrustedForwarder(abi.decode(ret, (address)));
        (success, ret) = address(forwarder).staticcall(abi.encodeWithSelector(
                forwarder.verify.selector,
                relayRequest, signature
            ));
        if (!success) {
            return (false, GsnUtils.getError(ret));
        }

        bytes memory encodedTx = abi.encodeWithSelector(IPaymaster(address(0)).acceptRelayedCall.selector,
            relayRequest, approvalData, maxPossibleGas
        );

        (success, ret) =
        relayRequest.relayData.paymaster.staticcall.gas(acceptRelayedCallGasLimit)(encodedTx);

        if (!success) {
            return (false, GsnUtils.getError(ret));
        }
        returnValue = abi.decode(ret, (string));
    }

    function getAndValidateGasLimits(uint256 initialGas, GSNTypes.GasData memory gasData, address paymaster)
    private
    view
    returns (uint256 maxPossibleGas, GSNTypes.GasLimits memory gasLimits)
    {
        gasLimits =
        IPaymaster(paymaster).getGasLimits();
        uint256 requiredGas =
        GAS_OVERHEAD +
        gasLimits.acceptRelayedCallGasLimit +
        gasLimits.preRelayedCallGasLimit +
        gasLimits.postRelayedCallGasLimit +
        gasData.gasLimit;

        // This transaction must have enough gas to forward the call to the recipient with the requested amount, and not
        // run out of gas later in this function.
        require(
            initialGas >= GAS_RESERVE + requiredGas,
            "Not enough gas left for recipientCallsAtomic to complete");

        // The maximum possible charge is the cost of transaction assuming all bytes of calldata are non-zero and
        // all paymaster and recipient calls consume entire available gas limit
        maxPossibleGas = calldatagascost() + requiredGas;
        uint256 maxPossibleCharge = calculateCharge(
            maxPossibleGas,
            gasData
        );

        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(maxPossibleCharge <= balances[paymaster],
            "Paymaster balance too low");
        return (maxPossibleGas, gasLimits);
    }

    /**
     * @notice Relay a transaction.
     *
     */
    function relayCall(
    // TODO: msg.sender used to be treated as 'relay' (now passed in a struct),
    //  make sure this does not have security impl
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    )
    external
    {
        uint256 initialGas = gasleft();
        bytes4 functionSelector = LibBytes.readBytes4(relayRequest.encodedFunction, 0);
        // Initial soundness checks - the relay must make sure these pass, or it will pay for a reverted transaction.
        // The worker must be controlled by a manager with a locked stake
        require(workerToManager[msg.sender] != address(0), "Unknown relay worker");
        require(
            stakeManager.isRelayManagerStaked(workerToManager[msg.sender], MINIMUM_STAKE, MINIMUM_UNSTAKE_DELAY),
            "relay manager not staked"
        );
        // A relay may use a higher gas price than the one requested by the signer (to e.g. get the transaction in a
        // block faster), but it must not be lower. The recipient will be charged for the requested gas price, not the
        // one used in the transaction.
        require(relayRequest.gasData.gasPrice <= tx.gasprice, "Invalid gas price");
        string memory recipientContext;
        GSNTypes.GasLimits memory gasLimits;
        {
            uint256 maxPossibleGas;
            (maxPossibleGas, gasLimits) = getAndValidateGasLimits(initialGas, relayRequest.gasData, relayRequest.relayData.paymaster);

            // We now verify the legitimacy of the transaction (it must be signed by the sender, and not be replayed),
            // and that the paymaster will agree to be charged for it.
            bool success;
            (success, recipientContext) =
            // TODO: this new RelayRequest is needed because solc doesn't implement calldata to memory conversion yet
            canRelay(
                GSNTypes.RelayRequest(
                    relayRequest.target,
                    relayRequest.encodedFunction,
                    relayRequest.gasData,
                    relayRequest.relayData),
                maxPossibleGas, gasLimits.acceptRelayedCallGasLimit, signature, approvalData);

            if (!success) {
                emit CanRelayFailed(
                    workerToManager[msg.sender],
                    msg.sender,
                    relayRequest.relayData.senderAddress,
                    relayRequest.target,
                    relayRequest.relayData.paymaster,
                    functionSelector,
                    recipientContext);
                return;
            }
        }

        // From this point on, this transaction will not revert nor run out of gas, and the recipient will be charged
        // for the gas spent.

        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        RelayCallStatus status;
        {
            bytes memory data =
            abi.encodeWithSelector(this.recipientCallsAtomic.selector, relayRequest, signature, gasLimits, initialGas, calldatagascost(), bytes(recipientContext));
            (, bytes memory relayCallStatus) = address(this).call(data);
            status = abi.decode(relayCallStatus, (RelayCallStatus));
        }

        // We now perform the actual charge calculation, based on the measured gas used
        uint256 charge = calculateCharge(
            calldatagascost() +
            (initialGas - gasleft()) +
            GAS_OVERHEAD,
            relayRequest.gasData
        );

        // We've already checked that the recipient has enough balance to pay for the relayed transaction, this is only
        // a sanity check to prevent overflows in case of bugs.
        require(balances[relayRequest.relayData.paymaster] >= charge, "Should not get here");
        balances[relayRequest.relayData.paymaster] -= charge;
        balances[workerToManager[msg.sender]] += charge;

        emit TransactionRelayed(
            workerToManager[msg.sender],
            msg.sender,
            relayRequest.relayData.senderAddress,
            relayRequest.target,
            relayRequest.relayData.paymaster,
            functionSelector,
            status,
            charge);
    }

    struct AtomicData {
        uint256 balanceBefore;
        bytes32 preReturnValue;
        bool relayedCallSuccess;
        bytes data;
    }

    function recipientCallsAtomic(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        GSNTypes.GasLimits calldata gasLimits,
        uint256 totalInitialGas,
        uint256 calldataGas,
        bytes calldata recipientContext
    )
    external
    returns (RelayCallStatus)
    {
        AtomicData memory atomicData;
        // A new gas measurement is performed inside recipientCallsAtomic, since
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
            IPaymaster(address(0)).preRelayedCall.selector, recipientContext
        );
        {
            bool success;
            bytes memory retData;
            // preRelayedCall may revert, but the recipient will still be charged: it should ensure in
            // acceptRelayedCall that this will not happen.
            (success, retData) = relayRequest.relayData.paymaster.call.gas(gasLimits.preRelayedCallGasLimit)(atomicData.data);
            if (!success) {
                revertWithStatus(RelayCallStatus.PreRelayedFailed);
            }
            atomicData.preReturnValue = abi.decode(retData, (bytes32));
        }

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data
        (atomicData.relayedCallSuccess,) =
        ITrustedForwarder(BaseRelayRecipient(relayRequest.target).getTrustedForwarder())
        .verifyAndCall(relayRequest, signature);

        // Finally, postRelayedCall is executed, with the relayedCall execution's status and a charge estimate
        // We now determine how much the recipient will be charged, to pass this value to postRelayedCall for accurate
        // accounting.
        atomicData.data = abi.encodeWithSelector(
            IPaymaster(address(0)).postRelayedCall.selector,
            recipientContext,
            atomicData.relayedCallSuccess,
            atomicData.preReturnValue,
            totalInitialGas - gasleft() + GAS_OVERHEAD + calldataGas,
            relayRequest.gasData
        );

        (bool successPost,) = relayRequest.relayData.paymaster.call.gas(gasLimits.postRelayedCallGasLimit)(atomicData.data);

        if (!successPost) {
            revertWithStatus(RelayCallStatus.PostRelayedFailed);
        }

        if (balances[relayRequest.relayData.paymaster] < atomicData.balanceBefore) {
            revertWithStatus(RelayCallStatus.RecipientBalanceChanged);
        }

        return atomicData.relayedCallSuccess ? RelayCallStatus.OK : RelayCallStatus.RelayedCallFailed;
    }

    /**
     * @dev Reverts the transaction with return data set to the ABI encoding of the status argument.
     */
    function revertWithStatus(RelayCallStatus status) private pure {
        bytes memory data = abi.encode(status);

        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            revert(dataPtr, dataSize)
        }
    }

    function calculateCharge(uint256 gasUsed, GSNTypes.GasData memory gasData) public view returns (uint256) {
        return gasData.baseRelayFee + (gasUsed * gasData.gasPrice * (100 + gasData.pctRelayFee)) / 100;
    }

    modifier penalizerOnly () {
        require(msg.sender == address(penalizer), "Not penalizer");
        _;
    }

    function penalize(address relayWorker, address payable beneficiary) external penalizerOnly {
        address relayManager = workerToManager[relayWorker];
        // The worker must be controlled by a manager with a locked stake
        require(relayManager != address(0), "Unknown relay worker");
        require(
            stakeManager.isRelayManagerStaked(relayManager, MINIMUM_STAKE, MINIMUM_UNSTAKE_DELAY),
            "relay manager not staked"
        );
        (uint256 totalStake, , , ) = stakeManager.stakes(relayManager);
        stakeManager.penalizeRelayManager(relayManager, beneficiary, totalStake);
    }
}
