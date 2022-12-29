/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
/* solhint-disable avoid-tx-origin */
/* solhint-disable bracket-align */
// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

// #if ENABLE_CONSOLE_LOG
import "hardhat/console.sol";
// #endif

import "./utils/MinLibBytes.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./utils/GsnUtils.sol";
import "./utils/GsnEip712Library.sol";
import "./utils/RelayHubValidator.sol";
import "./utils/GsnTypes.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPaymaster.sol";
import "./forwarder/IForwarder.sol";
import "./interfaces/IStakeManager.sol";
import "./interfaces/IRelayRegistrar.sol";
import "./interfaces/IStakeManager.sol";

/**
 * @title The RelayHub Implementation
 * @notice This contract implements the `IRelayHub` interface for the EVM-compatible networks.
 */
contract RelayHub is IRelayHub, Ownable, ERC165 {
    using ERC165Checker for address;
    using Address for address;

    address private constant DRY_RUN_ADDRESS = 0x0000000000000000000000000000000000000000;

    /// @inheritdoc IRelayHub
    function versionHub() override virtual public pure returns (string memory){
        return "3.0.0-beta.3+opengsn.hub.irelayhub";
    }

    IStakeManager internal immutable stakeManager;
    address internal immutable penalizer;
    address internal immutable batchGateway;
    address internal immutable relayRegistrar;

    RelayHubConfig internal config;

    /// @inheritdoc IRelayHub
    function getConfiguration() public override view returns (RelayHubConfig memory) {
        return config;
    }

    /// @inheritdoc IRelayHub
    function setConfiguration(RelayHubConfig memory _config) public override onlyOwner {
        require(_config.devFee < 100, "dev fee too high");
        config = _config;
        emit RelayHubConfigured(config);
    }

    // maps ERC-20 token address to a minimum stake for it
    mapping(IERC20 => uint256) internal minimumStakePerToken;

    /// @inheritdoc IRelayHub
    function setMinimumStakes(IERC20[] memory token, uint256[] memory minimumStake) public override onlyOwner {
        require(token.length == minimumStake.length, "setMinimumStakes: wrong length");
        for (uint256 i = 0; i < token.length; i++) {
            minimumStakePerToken[token[i]] = minimumStake[i];
            emit StakingTokenDataChanged(address(token[i]), minimumStake[i]);
        }
    }

    // maps relay worker's address to its manager's address
    mapping(address => address) internal workerToManager;

    // maps relay managers to the number of their workers
    mapping(address => uint256) internal workerCount;

    mapping(address => uint256) internal balances;

    uint256 internal immutable creationBlock;
    uint256 internal deprecationTime = type(uint256).max;

    constructor (
        IStakeManager _stakeManager,
        address _penalizer,
        address _batchGateway,
        address _relayRegistrar,
        RelayHubConfig memory _config
    ) {
        creationBlock = block.number;
        stakeManager = _stakeManager;
        penalizer = _penalizer;
        batchGateway = _batchGateway;
        relayRegistrar = _relayRegistrar;
        setConfiguration(_config);
    }

    /// @inheritdoc IRelayHub
    function getCreationBlock() external override virtual view returns (uint256){
        return creationBlock;
    }

    /// @inheritdoc IRelayHub
    function getDeprecationTime() external override view returns (uint256) {
        return deprecationTime;
    }

    /// @inheritdoc IRelayHub
    function getStakeManager() external override view returns (IStakeManager) {
        return stakeManager;
    }

    /// @inheritdoc IRelayHub
    function getPenalizer() external override view returns (address) {
        return penalizer;
    }

    /// @inheritdoc IRelayHub
    function getBatchGateway() external override view returns (address) {
        return batchGateway;
    }

    /// @inheritdoc IRelayHub
    function getRelayRegistrar() external override view returns (address) {
        return relayRegistrar;
    }

    /// @inheritdoc IRelayHub
    function getMinimumStakePerToken(IERC20 token) external override view returns (uint256) {
        return minimumStakePerToken[token];
    }

    /// @inheritdoc IRelayHub
    function getWorkerManager(address worker) external override view returns (address) {
        return workerToManager[worker];
    }

    /// @inheritdoc IRelayHub
    function getWorkerCount(address manager) external override view returns (uint256) {
        return workerCount[manager];
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IRelayHub).interfaceId ||
            interfaceId == type(Ownable).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IRelayHub
    function onRelayServerRegistered(address relayManager) external override {
        require(msg.sender == relayRegistrar, "caller is not relay registrar");
        verifyRelayManagerStaked(relayManager);
        require(workerCount[relayManager] > 0, "no relay workers");
        stakeManager.updateRelayKeepaliveTime(relayManager);
    }

    /// @inheritdoc IRelayHub
    function addRelayWorkers(address[] calldata newRelayWorkers) external override {
        address relayManager = msg.sender;
        uint256 newWorkerCount = workerCount[relayManager] + newRelayWorkers.length;
        workerCount[relayManager] = newWorkerCount;
        require(newWorkerCount <= config.maxWorkerCount, "too many workers");

        verifyRelayManagerStaked(relayManager);

        for (uint256 i = 0; i < newRelayWorkers.length; i++) {
            require(workerToManager[newRelayWorkers[i]] == address(0), "this worker has a manager");
            workerToManager[newRelayWorkers[i]] = relayManager;
        }

        emit RelayWorkersAdded(relayManager, newRelayWorkers, newWorkerCount);
    }

    /// @inheritdoc IRelayHub
    function depositFor(address target) public virtual override payable {
        require(target.supportsInterface(type(IPaymaster).interfaceId), "target is not a valid IPaymaster");
        uint256 amount = msg.value;

        balances[target] = balances[target] + amount;

        emit Deposited(target, msg.sender, amount);
    }

    /// @inheritdoc IRelayHub
    function balanceOf(address target) external override view returns (uint256) {
        return balances[target];
    }

    /// @inheritdoc IRelayHub
    function withdraw(address payable dest, uint256 amount) public override {
        uint256[] memory amounts = new uint256[](1);
        address payable[] memory destinations = new address payable[](1);
        amounts[0] = amount;
        destinations[0] = dest;
        withdrawMultiple(destinations, amounts);
    }

    /// @inheritdoc IRelayHub
    function withdrawMultiple(address payable[] memory dest, uint256[] memory amount) public override {
        address payable account = payable(msg.sender);
        for (uint256 i = 0; i < amount.length; i++) {
            // #if ENABLE_CONSOLE_LOG
            console.log("withdrawMultiple %s %s %s", balances[account], dest[i], amount[i]);
            // #endif
            uint256 balance = balances[account];
            require(balance >= amount[i], "insufficient funds");
            balances[account] = balance - amount[i];
            (bool success, ) = dest[i].call{value: amount[i]}("");
            require(success, "Transfer failed.");
            emit Withdrawn(account, dest[i], amount[i]);
        }
    }

    function verifyGasAndDataLimits(
        uint256 maxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        uint256 initialGasLeft
    )
    private
    view
    returns (IPaymaster.GasAndDataLimits memory gasAndDataLimits, uint256 maxPossibleGas) {
        gasAndDataLimits =
            IPaymaster(relayRequest.relayData.paymaster).getGasAndDataLimits{gas:50000}();
        require(msg.data.length <= gasAndDataLimits.calldataSizeLimit, "msg.data exceeded limit" );

        require(maxAcceptanceBudget >= gasAndDataLimits.acceptanceBudget, "acceptance budget too high");
        require(gasAndDataLimits.acceptanceBudget >= gasAndDataLimits.preRelayedCallGasLimit, "acceptance budget too low");

        maxPossibleGas = relayRequest.relayData.transactionCalldataGasUsed + initialGasLeft;

        uint256 maxPossibleCharge = calculateCharge(
            maxPossibleGas,
            relayRequest.relayData
        );

        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(maxPossibleCharge <= balances[relayRequest.relayData.paymaster],
            "Paymaster balance too low");
    }

    struct RelayCallData {
        bool success;
        bytes4 functionSelector;
        uint256 initialGasLeft;
        bytes recipientContext;
        bytes relayedCallReturnValue;
        IPaymaster.GasAndDataLimits gasAndDataLimits;
        RelayCallStatus status;
        uint256 innerGasUsed;
        uint256 maxPossibleGas;
        uint256 innerGasLimit;
        uint256 gasBeforeInner;
        uint256 gasUsed;
        uint256 devCharge;
        bytes retData;
        address relayManager;
        bytes32 relayRequestId;
        uint256 tmpInitialGas;
        bytes relayCallStatus;
    }

    /// @inheritdoc IRelayHub
    function relayCall(
        string calldata domainSeparatorName,
        uint256 maxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    )
    external
    override
    returns (
        bool paymasterAccepted,
        uint256 charge,
        IRelayHub.RelayCallStatus status,
        bytes memory returnValue)
    {
        RelayCallData memory vars;
        vars.initialGasLeft = aggregateGasleft();
        vars.relayRequestId = GsnUtils.getRelayRequestID(relayRequest, signature);

        // #if ENABLE_CONSOLE_LOG
        console.log("relayCall relayRequestId");
        console.logBytes32(vars.relayRequestId);
        console.log("relayCall relayRequest.request.from", relayRequest.request.from);
        console.log("relayCall relayRequest.request.to", relayRequest.request.to);
        console.log("relayCall relayRequest.request.value", relayRequest.request.value);
        console.log("relayCall relayRequest.request.gas", relayRequest.request.gas);
        console.log("relayCall relayRequest.request.nonce", relayRequest.request.nonce);
        console.log("relayCall relayRequest.request.validUntilTime", relayRequest.request.validUntilTime);

        console.log("relayCall relayRequest.relayData.maxFeePerGas", relayRequest.relayData.maxFeePerGas);
        console.log("relayCall relayRequest.relayData.maxPriorityFeePerGas", relayRequest.relayData.maxPriorityFeePerGas);
        console.log("relayCall relayRequest.relayData.transactionCalldataGasUsed", relayRequest.relayData.transactionCalldataGasUsed);
        console.log("relayCall relayRequest.relayData.relayWorker", relayRequest.relayData.relayWorker);
        console.log("relayCall relayRequest.relayData.paymaster", relayRequest.relayData.paymaster);
        console.log("relayCall relayRequest.relayData.forwarder", relayRequest.relayData.forwarder);
        console.log("relayCall relayRequest.relayData.clientId", relayRequest.relayData.clientId);

        console.log("relayCall domainSeparatorName");
        console.logString(domainSeparatorName);
        console.log("relayCall signature");
        console.logBytes(signature);
        console.log("relayCall approvalData");
        console.logBytes(approvalData);
        console.log("relayCall relayRequest.request.data");
        console.logBytes(relayRequest.request.data);
        console.log("relayCall relayRequest.relayData.paymasterData");
        console.logBytes(relayRequest.relayData.paymasterData);
        console.log("relayCall maxAcceptanceBudget", maxAcceptanceBudget);
        // #endif

        require(!isDeprecated(), "hub deprecated");
        vars.functionSelector = relayRequest.request.data.length>=4 ? MinLibBytes.readBytes4(relayRequest.request.data, 0) : bytes4(0);

        if (msg.sender != batchGateway && tx.origin != DRY_RUN_ADDRESS) {
            require(signature.length != 0, "missing signature or bad gateway");
            require(msg.sender == tx.origin, "relay worker must be EOA");
            require(msg.sender == relayRequest.relayData.relayWorker, "Not a right worker");
        }

        if (tx.origin != DRY_RUN_ADDRESS) {
            vars.relayManager = workerToManager[relayRequest.relayData.relayWorker];
            require(vars.relayManager != address(0), "Unknown relay worker");
            verifyRelayManagerStaked(vars.relayManager);
        }

        (vars.gasAndDataLimits, vars.maxPossibleGas) =
            verifyGasAndDataLimits(maxAcceptanceBudget, relayRequest, vars.initialGasLeft);

        RelayHubValidator.verifyTransactionPacking(domainSeparatorName,relayRequest,signature,approvalData);

    {

        //How much gas to pass down to innerRelayCall. must be lower than the default 63/64
        // actually, min(gasleft*63/64, gasleft-GAS_RESERVE) might be enough.
        vars.innerGasLimit = gasleft()*63/64- config.gasReserve;
        vars.gasBeforeInner = aggregateGasleft();

        /*
        Preparing to calculate "gasUseWithoutPost":
        MPG = calldataGasUsage + vars.initialGasLeft :: max possible gas, an approximate gas limit for the current transaction
        GU1 = MPG - gasleft(called right before innerRelayCall) :: gas actually used by current transaction until that point
        GU2 = innerGasLimit - gasleft(called inside the innerRelayCall just before preRelayedCall) :: gas actually used by innerRelayCall before calling postRelayCall
        GWP1 = GU1 + GU2 :: gas actually used by the entire transaction before calling postRelayCall
        TGO = config.gasOverhead + config.postOverhead :: extra that will be added to the charge to cover hidden costs
        GWP = GWP1 + TGO :: transaction "gas used without postRelayCall"
        */
        vars.tmpInitialGas = relayRequest.relayData.transactionCalldataGasUsed + vars.initialGasLeft + vars.innerGasLimit + config.gasOverhead + config.postOverhead;
        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        (vars.success, vars.relayCallStatus) = address(this).call{gas:vars.innerGasLimit}(
            abi.encodeWithSelector(RelayHub.innerRelayCall.selector, domainSeparatorName, relayRequest, signature, approvalData, vars.gasAndDataLimits,
            vars.tmpInitialGas - aggregateGasleft(), /* totalInitialGas */
            vars.maxPossibleGas
            )
        );
        vars.innerGasUsed = vars.gasBeforeInner-aggregateGasleft();
        (vars.status, vars.relayedCallReturnValue) = abi.decode(vars.relayCallStatus, (RelayCallStatus, bytes));
        if ( vars.relayedCallReturnValue.length>0 ) {
            emit TransactionResult(vars.status, vars.relayedCallReturnValue);
        }
    }
    {
        if (!vars.success) {
            //Failure cases where the PM doesn't pay
            if (vars.status == RelayCallStatus.RejectedByPreRelayed ||
                    (vars.innerGasUsed <= vars.gasAndDataLimits.acceptanceBudget + relayRequest.relayData.transactionCalldataGasUsed) && (
                    vars.status == RelayCallStatus.RejectedByForwarder ||
                    vars.status == RelayCallStatus.RejectedByRecipientRevert  //can only be thrown if rejectOnRecipientRevert==true
                )) {
                emit TransactionRejectedByPaymaster(
                    vars.relayManager,
                    relayRequest.relayData.paymaster,
                    vars.relayRequestId,
                    relayRequest.request.from,
                    relayRequest.request.to,
                    msg.sender,
                    vars.functionSelector,
                    vars.innerGasUsed,
                    vars.relayedCallReturnValue);
                return (false, 0, vars.status, vars.relayedCallReturnValue);
            }
        }

        // We now perform the actual charge calculation, based on the measured gas used
        vars.gasUsed = relayRequest.relayData.transactionCalldataGasUsed + (vars.initialGasLeft - aggregateGasleft()) + config.gasOverhead;
        charge = calculateCharge(vars.gasUsed, relayRequest.relayData);
        vars.devCharge = calculateDevCharge(charge);

        balances[relayRequest.relayData.paymaster] = balances[relayRequest.relayData.paymaster] - charge;
        balances[vars.relayManager] = balances[vars.relayManager] + (charge - vars.devCharge);
        if (vars.devCharge > 0) { // save some gas in case of zero dev charge
            balances[config.devAddress] = balances[config.devAddress] + vars.devCharge;
        }

        {
            address from = relayRequest.request.from;
            address to = relayRequest.request.to;
            address paymaster = relayRequest.relayData.paymaster;
            emit TransactionRelayed(
                vars.relayManager,
                msg.sender,
                vars.relayRequestId,
                from,
                to,
                paymaster,
                vars.functionSelector,
                vars.status,
                charge);
        }

        // avoid variable size memory copying after gas calculation completed on-chain
        if (tx.origin == DRY_RUN_ADDRESS) {
            return (true, charge, vars.status, vars.relayedCallReturnValue);
        }
        return (true, charge, vars.status, "");
    }
    }

    struct InnerRelayCallData {
        uint256 initialGasLeft;
        uint256 gasUsedToCallInner;
        uint256 balanceBefore;
        bytes32 preReturnValue;
        bool relayedCallSuccess;
        bytes relayedCallReturnValue;
        bytes recipientContext;
        bytes data;
        bool rejectOnRecipientRevert;
    }

    /**
     * @notice This method can only by called by this `RelayHub`.
     * It wraps the execution of the `RelayRequest` in a revertable frame context.
     */
    function innerRelayCall(
        string calldata domainSeparatorName,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        IPaymaster.GasAndDataLimits calldata gasAndDataLimits,
        uint256 totalInitialGas,
        uint256 maxPossibleGas
    )
    external
    returns (RelayCallStatus, bytes memory)
    {
        InnerRelayCallData memory vars;
        vars.initialGasLeft = aggregateGasleft();
        vars.gasUsedToCallInner = totalInitialGas - gasleft();
        // A new gas measurement is performed inside innerRelayCall, since
        // due to EIP150 available gas amounts cannot be directly compared across external calls

        // This external function can only be called by RelayHub itself, creating an internal transaction. Calls to the
        // recipient (preRelayedCall, the relayedCall, and postRelayedCall) are called from inside this transaction.
        require(msg.sender == address(this), "Must be called by RelayHub");

        // If either pre or post reverts, the whole internal transaction will be reverted, reverting all side effects on
        // the recipient. The recipient will still be charged for the used gas by the relay.

        // The paymaster is no allowed to withdraw balance from RelayHub during a relayed transaction. We check pre and
        // post state to ensure this doesn't happen.
        vars.balanceBefore = balances[relayRequest.relayData.paymaster];

        // First preRelayedCall is executed.
        // Note: we open a new block to avoid growing the stack too much.
        vars.data = abi.encodeWithSelector(
            IPaymaster.preRelayedCall.selector,
            relayRequest, signature, approvalData, maxPossibleGas
        );
        {
            bool success;
            bytes memory retData;
            (success, retData) = relayRequest.relayData.paymaster.call{gas:gasAndDataLimits.preRelayedCallGasLimit}(vars.data);
            if (!success) {
                GsnEip712Library.truncateInPlace(retData);
                revertWithStatus(RelayCallStatus.RejectedByPreRelayed, retData);
            }
            (vars.recipientContext, vars.rejectOnRecipientRevert) = abi.decode(retData, (bytes,bool));
        }

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data

        {
            bool forwarderSuccess;
            (forwarderSuccess, vars.relayedCallSuccess, vars.relayedCallReturnValue) = GsnEip712Library.execute(domainSeparatorName, relayRequest, signature);
            if ( !forwarderSuccess ) {
                revertWithStatus(RelayCallStatus.RejectedByForwarder, vars.relayedCallReturnValue);
            }

            if (vars.rejectOnRecipientRevert && !vars.relayedCallSuccess) {
                // we trusted the recipient, but it reverted...
                revertWithStatus(RelayCallStatus.RejectedByRecipientRevert, vars.relayedCallReturnValue);
            }
        }
        // Finally, postRelayedCall is executed, with the relayedCall execution's status and a charge estimate
        // We now determine how much the recipient will be charged, to pass this value to postRelayedCall for accurate
        // accounting.
        vars.data = abi.encodeWithSelector(
            IPaymaster.postRelayedCall.selector,
            vars.recipientContext,
            vars.relayedCallSuccess,
            vars.gasUsedToCallInner + (vars.initialGasLeft - aggregateGasleft()), /*gasUseWithoutPost*/
            relayRequest.relayData
        );

        {
        (bool successPost,bytes memory ret) = relayRequest.relayData.paymaster.call{gas:gasAndDataLimits.postRelayedCallGasLimit}(vars.data);

            if (!successPost) {
                revertWithStatus(RelayCallStatus.PostRelayedFailed, ret);
            }
        }

        if (balances[relayRequest.relayData.paymaster] < vars.balanceBefore) {
            revertWithStatus(RelayCallStatus.PaymasterBalanceChanged, "");
        }

        return (vars.relayedCallSuccess ? RelayCallStatus.OK : RelayCallStatus.RelayedCallFailed, vars.relayedCallReturnValue);
    }

    /**
     * @dev Reverts the transaction with return data set to the ABI encoding of the status argument (and revert reason data)
     */
    function revertWithStatus(RelayCallStatus status, bytes memory ret) private pure {
        bytes memory data = abi.encode(status, ret);
        GsnEip712Library.truncateInPlace(data);

        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            revert(dataPtr, dataSize)
        }
    }

    /// @inheritdoc IRelayHub
    function calculateDevCharge(uint256 charge) public override virtual view returns (uint256){
        if (config.devFee == 0){ // save some gas in case of zero dev charge
            return 0;
        }
        unchecked {
        return charge * config.devFee / 100;
        }
    }

    /// @inheritdoc IRelayHub
    function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) public override virtual view returns (uint256) {
        uint256 basefee;
        if (relayData.maxFeePerGas == relayData.maxPriorityFeePerGas) {
            basefee = 0;
        } else {
            basefee = block.basefee;
        }
        uint256 chargeableGasPrice = Math.min(relayData.maxFeePerGas, Math.min(tx.gasprice, basefee + relayData.maxPriorityFeePerGas));
        return config.baseRelayFee + (gasUsed * chargeableGasPrice * (config.pctRelayFee + 100)) / 100;
    }

    /// @inheritdoc IRelayHub
    function verifyRelayManagerStaked(address relayManager) public override view {
        (IStakeManager.StakeInfo memory info, bool isHubAuthorized) = stakeManager.getStakeInfo(relayManager);
        uint256 minimumStake = minimumStakePerToken[info.token];
        require(info.token != IERC20(address(0)), "relay manager not staked");
        require(info.stake >= minimumStake, "stake amount is too small");
        require(minimumStake != 0, "staking this token is forbidden");
        require(info.unstakeDelay >= config.minimumUnstakeDelay, "unstake delay is too small");
        require(info.withdrawTime == 0, "stake has been withdrawn");
        require(isHubAuthorized, "this hub is not authorized by SM");
    }

    /// @inheritdoc IRelayHub
    function deprecateHub(uint256 _deprecationTime) public override onlyOwner {
        require(!isDeprecated(), "Already deprecated");
        deprecationTime = _deprecationTime;
        emit HubDeprecated(deprecationTime);
    }

    /// @inheritdoc IRelayHub
    function isDeprecated() public override view returns (bool) {
        return block.timestamp >= deprecationTime;
    }

    /// @notice Prevents any address other than the `Penalizer` from calling this method.
    modifier penalizerOnly () {
        require(msg.sender == penalizer, "Not penalizer");
        _;
    }

    /// @inheritdoc IRelayHub
    function penalize(address relayWorker, address payable beneficiary) external override penalizerOnly {
        address relayManager = workerToManager[relayWorker];
        // The worker must be controlled by a manager with a locked stake
        require(relayManager != address(0), "Unknown relay worker");
        (IStakeManager.StakeInfo memory stakeInfo,) = stakeManager.getStakeInfo(relayManager);
        require(stakeInfo.stake > 0, "relay manager not staked");
        stakeManager.penalizeRelayManager(relayManager, beneficiary, stakeInfo.stake);
    }

    /// @inheritdoc IRelayHub
    function isRelayEscheatable(address relayManager) public view override returns (bool){
        return stakeManager.isRelayEscheatable(relayManager);
    }

    /// @inheritdoc IRelayHub
    function escheatAbandonedRelayBalance(address relayManager) external override onlyOwner {
        require(stakeManager.isRelayEscheatable(relayManager), "relay server not escheatable yet");
        uint256 balance = balances[relayManager];
        balances[relayManager] = 0;
        balances[config.devAddress] = balances[config.devAddress] + balance;
        emit AbandonedRelayManagerBalanceEscheated(relayManager, balance);
    }

    /// @inheritdoc IRelayHub
    function aggregateGasleft() public override virtual view returns (uint256){
        return gasleft();
    }
}
