/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable not-rely-on-time */
pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "@0x/contracts-utils/contracts/src/LibBytes.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

import "./utils/EIP712Sig.sol";
import "./utils/GsnUtils.sol";
import "./utils/RLPReader.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IGasSponsor.sol";

contract RelayHub is IRelayHub {

    string constant public COMMIT_ID = "$Id$";

    using ECDSA for bytes32;

    // Minimum stake a relay can have. An attack to the network will never cost less than half this value.
    uint256 constant private MINIMUM_STAKE = 1 ether;

    // Minimum unstake delay. A relay needs to wait for this time to elapse after deregistering to retrieve its stake.
    uint256 constant private MINIMUM_UNSTAKE_DELAY = 1 weeks;
    // Maximum unstake delay. Prevents relays from locking their funds into the RelayHub for too long.
    uint256 constant private MAXIMUM_UNSTAKE_DELAY = 12 weeks;

    // Minimum balance required for a relay to register or re-register. Prevents user error in registering a relay that
    // will not be able to immediatly start serving requests.
    uint256 constant private MINIMUM_RELAY_BALANCE = 0.1 ether;

    // Maximum funds that can be deposited at once. Prevents user error by disallowing large deposits.
    uint256 constant private MAXIMUM_RECIPIENT_DEPOSIT = 2 ether;

    /**
    * the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */

    // Gas cost of all relayCall() instructions before first gasleft() and after last gasleft()
    uint256 constant private GAS_OVERHEAD = 54756;

    // Gas cost of all relayCall() instructions after first gasleft() and before last gasleft()
    uint256 constant private GAS_RESERVE = 100000;

    // Approximation of how much calling recipientCallsAtomic costs
    uint256 constant private RECIPIENT_CALLS_ATOMIC_OVERHEAD = 5000;

    // Gas stipends for acceptRelayedCall, preRelayedCall and postRelayedCall
    uint256 constant private ACCEPT_RELAYED_CALL_MAX_GAS = 50000;
    uint256 constant private PRE_RELAYED_CALL_MAX_GAS = 100000;
    uint256 constant private POST_RELAYED_CALL_MAX_GAS = 100000;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    enum AtomicRecipientCallsStatus {OK, CanRelayFailed, RelayedCallFailed, PreRelayedFailed, PostRelayedFailed}

    /// @param stake - ether staked for this relay
    /// @param unstakeDelay - time that must elapse before the owner can retrieve the stake after calling remove
    /// @param unstakeTime - time when unstake will be callable.
    ///        A value of zero indicates the relay has not been removed.
    /// @param owner - relay's owner, will receive revenue and manage it (call stake, remove and unstake).
    struct Relay {
        uint256 stake;
        uint256 unstakeDelay;
        uint256 unstakeTime;
        address payable owner;
        RelayState state;
    }

    mapping(address => Relay) private relays;
    mapping(address => uint256) private balances;

    string public version = "1.0.0";

    EIP712Sig private eip712sig;

    constructor () public {
        eip712sig = new EIP712Sig(address(this));
    }

    function stake(address relay, uint256 unstakeDelay) external payable {
        if (relays[relay].state == RelayState.Unknown) {
            require(msg.sender != relay, "relay cannot stake for itself");
            relays[relay].owner = msg.sender;
            relays[relay].state = RelayState.Staked;

        } else if ((relays[relay].state == RelayState.Staked) || (relays[relay].state == RelayState.Registered)) {
            require(relays[relay].owner == msg.sender, "not owner");

        } else {
            revert("wrong state for stake");
        }

        // Increase the stake

        uint256 addedStake = msg.value;
        relays[relay].stake += addedStake;

        // The added stake may be e.g. zero when only the unstake delay is being updated
        require(relays[relay].stake >= MINIMUM_STAKE, "stake lower than minimum");

        // Increase the unstake delay

        require(unstakeDelay >= MINIMUM_UNSTAKE_DELAY, "delay lower than minimum");
        require(unstakeDelay <= MAXIMUM_UNSTAKE_DELAY, "delay higher than maximum");

        require(unstakeDelay >= relays[relay].unstakeDelay, "unstakeDelay cannot be decreased");
        relays[relay].unstakeDelay = unstakeDelay;

        emit Staked(relay, relays[relay].stake, relays[relay].unstakeDelay);
    }

    function registerRelay(uint256 transactionFee, string memory url) public {
        address relay = msg.sender;

        // solhint-disable-next-line avoid-tx-origin
        require(relay == tx.origin, "Contracts cannot register as relays");
        require(
            relays[relay].state == RelayState.Staked ||
            relays[relay].state == RelayState.Registered,
            "wrong state for stake");
        require(relay.balance >= MINIMUM_RELAY_BALANCE, "balance lower than minimum");

        if (relays[relay].state != RelayState.Registered) {
            relays[relay].state = RelayState.Registered;
        }

        emit RelayAdded(
            relay, relays[relay].owner, transactionFee, relays[relay].stake, relays[relay].unstakeDelay, url);
    }

    function removeRelayByOwner(address relay) public {
        require(relays[relay].owner == msg.sender, "not owner");
        require(
            relays[relay].state == RelayState.Staked ||
            relays[relay].state == RelayState.Registered,
            "already removed");

        // Start the unstake counter
        // TODO: I tend to agree with solhint here - lets use some number of blocks instead
        // solhint-disable-next-line not-rely-on-time
        relays[relay].unstakeTime = relays[relay].unstakeDelay + now;
        relays[relay].state = RelayState.Removed;

        emit RelayRemoved(relay, relays[relay].unstakeTime);
    }

    function unstake(address relay) public {
        require(canUnstake(relay), "canUnstake failed");
        require(relays[relay].owner == msg.sender, "not owner");

        address payable owner = msg.sender;
        uint256 amount = relays[relay].stake;

        delete relays[relay];

        owner.transfer(amount);
        emit Unstaked(relay, amount);
    }

    function getRelay(address relay)
    external
    view
    returns (uint256 totalStake, uint256 unstakeDelay, uint256 unstakeTime, address payable owner, RelayState state) {
        totalStake = relays[relay].stake;
        unstakeDelay = relays[relay].unstakeDelay;
        unstakeTime = relays[relay].unstakeTime;
        owner = relays[relay].owner;
        state = relays[relay].state;
    }

    /**
     * deposit ether for a contract.
     * This ether will be used to repay relay calls into this contract.
     * Contract owner should monitor the balance of his contract, and make sure
     * to deposit more, otherwise the contract won't be able to receive relayed calls.
     * Unused deposited can be withdrawn with `withdraw()`
     */
    function depositFor(address target) public payable {
        uint256 amount = msg.value;
        require(amount <= MAXIMUM_RECIPIENT_DEPOSIT, "deposit too big");

        balances[target] = SafeMath.add(balances[target], amount);

        emit Deposited(target, msg.sender, amount);
    }

    //check the deposit balance of a contract.
    function balanceOf(address target) external view returns (uint256) {
        return balances[target];
    }

    /**
     * withdraw funds.
     * caller is either a relay owner, withdrawing collected transaction fees.
     * or a IRelayRecipient contract, withdrawing its deposit.
     * note that while everyone can `depositFor()` a contract, only
     * the contract itself can withdraw its funds.
     */
    function withdraw(uint256 amount, address payable dest) public {
        address payable account = msg.sender;
        require(balances[account] >= amount, "insufficient funds");

        balances[account] -= amount;
        dest.transfer(amount);

        emit Withdrawn(account, dest, amount);
    }

    function getNonce(address from) external view returns (uint256) {
        return nonces[from];
    }

    function canUnstake(address relay) public view returns (bool) {
        // TODO: I tend to agree with solhint here - lets use some number of blocks instead
        // solhint-disable-next-line not-rely-on-time
        return relays[relay].unstakeTime > 0 && relays[relay].unstakeTime <= now;
        // Finished the unstaking delay period?
    }

    function canRelay(
        EIP712Sig.RelayRequest memory relayRequest,
        bytes memory signature,
        bytes memory approvalData
    )
    public view returns (uint256 status, bytes memory recipientContext)
    {
        // Verify the sender's signature on the transaction - note that approvalData is *not* signed
        if (!eip712sig.verify(relayRequest, signature)) {
            return (uint256(PreconditionCheck.WrongSignature), "");
        }

        // Verify the transaction is not being replayed
        if (nonces[relayRequest.relayData.senderAccount] != relayRequest.relayData.senderNonce) {
            return (uint256(PreconditionCheck.WrongNonce), "");
        }

        uint256 maxCharge = maxPossibleCharge(
            relayRequest.callData.gasLimit, relayRequest.callData.gasPrice, relayRequest.relayData.pctRelayFee);
        bytes memory encodedTx = abi.encodeWithSelector(IGasSponsor(address(0)).acceptRelayedCall.selector,
            relayRequest, approvalData, maxCharge
        );

        (bool success, bytes memory returndata) =
        relayRequest.relayData.gasSponsor.staticcall.gas(ACCEPT_RELAYED_CALL_MAX_GAS)(encodedTx);

        if (!success) {
            return (uint256(PreconditionCheck.AcceptRelayedCallReverted), "");
        } else {
            (status, recipientContext) = abi.decode(returndata, (uint256, bytes));

            // This can be either PreconditionCheck.OK or a custom error code
            if ((status == 0) || (status > 10)) {
                return (status, recipientContext);
            } else {
                // Error codes [1-10] are reserved to RelayHub
                return (uint256(PreconditionCheck.InvalidRecipientStatusCode), "");
            }
        }
    }

    /**
     * @notice Relay a transaction.
     *
     */
    function relayCall(
    // TODO: msg.sender used to be treated as 'relay' (now passed in a struct),
    //  make sure this does not have security impl
        EIP712Sig.RelayRequest memory relayRequest,
        bytes memory signature,
        bytes memory approvalData
    )
    public
    {
        uint256 initialGas = gasleft();

        // Initial soundness checks - the relay must make sure these pass, or it will pay for a reverted transaction.

        // The relay must be registered
        require(relays[msg.sender].state == RelayState.Registered, "Unknown relay");

        // A relay may use a higher gas price than the one requested by the signer (to e.g. get the transaction in a
        // block faster), but it must not be lower. The recipient will be charged for the requested gas price, not the
        // one used in the transaction.
        require(relayRequest.callData.gasPrice <= tx.gasprice, "Invalid gas price");

        // This transaction must have enough gas to forward the call to the recipient with the requested amount, and not
        // run out of gas later in this function.
        require(
            initialGas >= SafeMath.sub(requiredGas(relayRequest.callData.gasLimit), GAS_OVERHEAD),
            "Not enough gasleft()");

        address sponsor = relayRequest.relayData.gasSponsor;
        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(
            maxPossibleCharge(
                relayRequest.callData.gasLimit,
                relayRequest.callData.gasPrice,
                relayRequest.relayData.pctRelayFee
            ) <= balances[sponsor],
            "Sponsor balance too low");

        bytes4 functionSelector = LibBytes.readBytes4(relayRequest.callData.encodedFunction, 0);

        bytes memory recipientContext;
        // We now verify the legitimacy of the transaction (it must be signed by the sender, and not be replayed),
        // and that the recpient will accept to be charged by it.
        uint256 preconditionCheck;
        (preconditionCheck, recipientContext) = canRelay(relayRequest, signature, approvalData);

        if (preconditionCheck != uint256(PreconditionCheck.OK)) {
            emit CanRelayFailed(
                msg.sender,
                relayRequest.relayData.senderAccount,
                relayRequest.callData.target,
                sponsor,
                functionSelector,
                preconditionCheck);
            return;
        }

        // From this point on, this transaction will not revert nor run out of gas, and the recipient will be charged
        // for the gas spent.

        // The sender's nonce is advanced to prevent transaction replays.
        nonces[relayRequest.relayData.senderAccount]++;

        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        RelayCallStatus status;
        uint256 preChecksGas = initialGas - gasleft();
        bytes memory data =
        abi.encodeWithSelector(this.recipientCallsAtomic.selector, relayRequest, preChecksGas, recipientContext);
        (, bytes memory relayCallStatus) = address(this).call(data);
        status = abi.decode(relayCallStatus, (RelayCallStatus));

        // We now perform the actual charge calculation, based on the measured gas used
        uint256 charge = calculateCharge(
            getChargeableGas(initialGas - gasleft(), false),
            relayRequest.callData.gasPrice,
            relayRequest.relayData.pctRelayFee
        );

        // We've already checked that the recipient has enough balance to pay for the relayed transaction, this is only
        // a sanity check to prevent overflows in case of bugs.
        require(balances[sponsor] >= charge, "Should not get here");
        balances[sponsor] -= charge;
        balances[relays[msg.sender].owner] += charge;

        emit TransactionRelayed(
            msg.sender,
            relayRequest.relayData.senderAccount,
            relayRequest.callData.target,
            sponsor,
            functionSelector,
            status,
            charge);
    }

    struct AtomicData {
        uint256 atomicInitialGas;
        uint256 balanceBefore;
        bytes32 preReturnValue;
        bool relayedCallSuccess;
    }

    function recipientCallsAtomic(
        EIP712Sig.RelayRequest calldata relayRequest,
        uint256 preChecksGas,
        bytes calldata recipientContext
    )
    external
    returns (RelayCallStatus)
    {
        AtomicData memory atomicData;
        atomicData.atomicInitialGas = gasleft();
        // A new gas measurement is performed inside recipientCallsAtomic, since
        // due to EIP150 available gas amounts cannot be directly compared across external calls

        // This external function can only be called by RelayHub itself, creating an internal transaction. Calls to the
        // recipient (preRelayedCall, the relayedCall, and postRelayedCall) are called from inside this transaction.
        require(msg.sender == address(this), "Only RelayHub should call this function");

        // If either pre or post reverts, the whole internal transaction will be reverted, reverting all side effects on
        // the recipient. The recipient will still be charged for the used gas by the relay.

        // The recipient is no allowed to withdraw balance from RelayHub during a relayed transaction. We check pre and
        // post state to ensure this doesn't happen.
        atomicData.balanceBefore = balances[relayRequest.relayData.gasSponsor];

        // First preRelayedCall is executed.
        // Note: we open a new block to avoid growing the stack too much.
        bytes memory data = abi.encodeWithSelector(
            IGasSponsor(address(0)).preRelayedCall.selector, recipientContext
        );

        // preRelayedCall may revert, but the recipient will still be charged: it should ensure in
        // acceptRelayedCall that this will not happen.
        (bool success, bytes memory retData) = relayRequest.relayData.gasSponsor.call.gas(PRE_RELAYED_CALL_MAX_GAS)(data);

        if (!success) {
            revertWithStatus(RelayCallStatus.PreRelayedFailed);
        }

        atomicData.preReturnValue = abi.decode(retData, (bytes32));

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data
        (atomicData.relayedCallSuccess,) =
        relayRequest.callData.target.call.gas(relayRequest.callData.gasLimit)
        (abi.encodePacked(relayRequest.callData.encodedFunction, relayRequest.relayData.senderAccount));

        // Finally, postRelayedCall is executed, with the relayedCall execution's status and a charge estimate
        // We now determine how much the recipient will be charged, to pass this value to postRelayedCall for accurate
        // accounting.
        uint256 estimatedCharge = calculateCharge(
            getChargeableGas(preChecksGas + atomicData.atomicInitialGas - gasleft(), true),
            relayRequest.callData.gasPrice,
            relayRequest.relayData.pctRelayFee
        );

        data = abi.encodeWithSelector(
            IGasSponsor(address(0)).postRelayedCall.selector,
            recipientContext, atomicData.relayedCallSuccess, estimatedCharge, atomicData.preReturnValue
        );

        (bool successPost,) = relayRequest.relayData.gasSponsor.call.gas(POST_RELAYED_CALL_MAX_GAS)(data);

        if (!successPost) {
            revertWithStatus(RelayCallStatus.PostRelayedFailed);
        }

        if (balances[relayRequest.relayData.gasSponsor] < atomicData.balanceBefore) {
            revertWithStatus(RelayCallStatus.RecipientBalanceChanged);
        }

        return atomicData.relayedCallSuccess ? RelayCallStatus.OK : RelayCallStatus.RelayedCallFailed;
    }

    /**
     * @dev Reverts the transaction with returndata set to the ABI encoding of the status argument.
     */
    function revertWithStatus(RelayCallStatus status) private pure {
        bytes memory data = abi.encode(status);

        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            revert(dataPtr, dataSize)
        }
    }

    function requiredGas(uint256 relayedCallStipend) public view returns (uint256) {
        return
        GAS_OVERHEAD +
        GAS_RESERVE +
        ACCEPT_RELAYED_CALL_MAX_GAS +
        PRE_RELAYED_CALL_MAX_GAS +
        POST_RELAYED_CALL_MAX_GAS +
        relayedCallStipend;
    }

    function maxPossibleCharge(
        uint256 relayedCallStipend,
        uint256 gasPrice,
        uint256 transactionFee)
    public
    view
    returns (uint256) {
        return calculateCharge(requiredGas(relayedCallStipend), gasPrice, transactionFee);
    }

    function calculateCharge(uint256 gas, uint256 gasPrice, uint256 fee) private pure returns (uint256) {
        // The fee is expressed as a percentage. E.g. a value of 40 stands for a 40% fee, so the recipient will be
        // charged for 1.4 times the spent amount.
        return (gas * gasPrice * (100 + fee)) / 100;
    }

    function getChargeableGas(uint256 gasUsed, bool postRelayedCallEstimation) private pure returns (uint256) {
        return
        GAS_OVERHEAD +
        gasUsed +
        (postRelayedCallEstimation ? (POST_RELAYED_CALL_MAX_GAS + RECIPIENT_CALLS_ATOMIC_OVERHEAD) : 0);
    }

    struct Transaction {
        uint256 nonce;
        uint256 gasPrice;
        uint256 gasLimit;
        address to;
        uint256 value;
        bytes data;
    }

    function decodeTransaction(bytes memory rawTransaction) private pure returns (Transaction memory transaction) {
        (transaction.nonce,
        transaction.gasPrice,
        transaction.gasLimit,
        transaction.to,
        transaction.value,
        transaction.data) = RLPReader.decodeTransaction(rawTransaction);
        return transaction;

    }

    function penalizeRepeatedNonce(
        bytes memory unsignedTx1,
        bytes memory signature1,
        bytes memory unsignedTx2,
        bytes memory signature2)
    public
    {
        // Can be called by anyone.
        // If a relay attacked the system by signing multiple transactions with the same nonce
        // (so only one is accepted), anyone can grab both transactions from the blockchain and submit them here.
        // Check whether unsignedTx1 != unsignedTx2, that both are signed by the same address,
        // and that unsignedTx1.nonce == unsignedTx2.nonce.
        // If all conditions are met, relay is considered an "offending relay".
        // The offending relay will be unregistered immediately, its stake will be forfeited and given
        // to the address who reported it (msg.sender), thus incentivizing anyone to report offending relays.
        // If reported via a relay, the forfeited stake is split between
        // msg.sender (the relay used for reporting) and the address that reported it.

        address addr1 = keccak256(abi.encodePacked(unsignedTx1)).recover(signature1);
        address addr2 = keccak256(abi.encodePacked(unsignedTx2)).recover(signature2);

        require(addr1 == addr2, "Different signer");

        Transaction memory decodedTx1 = decodeTransaction(unsignedTx1);
        Transaction memory decodedTx2 = decodeTransaction(unsignedTx2);

        // checking that the same nonce is used in both transaction, with both signed by the same address
        // and the actual data is different
        // note: we compare the hash of the tx to save gas over iterating both byte arrays
        require(decodedTx1.nonce == decodedTx2.nonce, "Different nonce");

        bytes memory dataToCheck1 =
        abi.encodePacked(decodedTx1.data, decodedTx1.gasLimit, decodedTx1.to, decodedTx1.value);

        bytes memory dataToCheck2 =
        abi.encodePacked(decodedTx2.data, decodedTx2.gasLimit, decodedTx2.to, decodedTx2.value);

        require(keccak256(dataToCheck1) != keccak256(dataToCheck2), "tx is equal");

        penalize(addr1);
    }

    function penalizeIllegalTransaction(bytes memory unsignedTx, bytes memory signature) public {
        Transaction memory decodedTx = decodeTransaction(unsignedTx);
        if (decodedTx.to == address(this)) {
            bytes4 selector = GsnUtils.getMethodSig(decodedTx.data);
            // Note: If RelayHub's relay API is extended, the selectors must be added to the ones listed here
            require(
                selector != this.relayCall.selector &&
                selector != this.registerRelay.selector,
                "Legal relay transaction");
        }

        address relay = keccak256(abi.encodePacked(unsignedTx)).recover(signature);

        penalize(relay);
    }

    function penalize(address relay) private {
        require((relays[relay].state == RelayState.Staked) ||
        (relays[relay].state == RelayState.Registered) ||
            (relays[relay].state == RelayState.Removed), "Unstaked relay");

        // Half of the stake will be burned (sent to address 0)
        uint256 totalStake = relays[relay].stake;
        uint256 toBurn = SafeMath.div(totalStake, 2);
        uint256 reward = SafeMath.sub(totalStake, toBurn);

        if (relays[relay].state == RelayState.Registered) {
            emit RelayRemoved(relay, now);
        }

        // The relay is deleted
        delete relays[relay];

        // Ether is burned and transferred
        address(0).transfer(toBurn);
        address payable reporter = msg.sender;
        reporter.transfer(reward);

        emit Penalized(relay, reporter, reward);
    }
}
