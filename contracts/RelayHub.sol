pragma solidity ^0.5.5;
pragma experimental ABIEncoderV2;

import "./IRelayHub.sol";
import "./IRelayRecipient.sol";
import "./GsnUtils.sol";
import "./RLPReader.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

contract RelayHub is IRelayHub {
    using ECDSA for bytes32;

    // Minimum stake a relay can have. An attack to the network will never cost less than half this value.
    uint256 constant private minimumStake = 1 ether;

    // Minimum unstake delay. A relay needs to wait for this time to elapse after deregistering to retrieve its stake.
    uint256 constant private minimumUnstakeDelay = 1 weeks;
    // Maximum unstake delay. Prevents relays from locking their funds into the RelayHub for too long.
    uint256 constant private maximumUnstakeDelay = 12 weeks;

    // Minimum balance required for a relay to register or re-register. Prevents user error in registering a relay that
    // will not be able to immediatly start serving requests.
    uint256 constant private minimumRelayBalance = 0.1 ether;

    // Maximum funds that can be deposited at once. Prevents user error by disallowing large deposits.
    uint256 constant private maximumRecipientDeposit = 2 ether;

    /**
    * the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */

    // Gas cost of all relayCall() instructions before first gasleft() and after last gasleft()
    uint256 constant private gasOverhead = 49936;

    // Gas cost of all relayCall() instructions after first gasleft() and before last gasleft()
    uint256 constant private gasReserve = 100000;

    // Approximation of how much calling recipientCallsAtomic costs
    uint256 constant private recipientCallsAtomicOverhead = 5000;

    // Gas stipends for acceptRelayedCall, preRelayedCall and postRelayedCall
    uint256 constant private acceptRelayedCallMaxGas = 50000;
    uint256 constant private preRelayedCallMaxGas = 100000;
    uint256 constant private postRelayedCallMaxGas = 100000;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    enum AtomicRecipientCallsStatus {OK, CanRelayFailed, RelayedCallFailed, PreRelayedFailed, PostRelayedFailed}

    struct Relay {
        uint256 stake;          // Ether staked for this relay
        uint256 unstakeDelay;   // Time that must elapse before the owner can retrieve the stake after calling remove
        uint256 unstakeTime;    // Time when unstake will be callable. A value of zero indicates the relay has not been removed.
        address payable owner;  // Relay's owner, will receive revenue and manage it (call stake, remove and unstake).
        RelayState state;
    }

    mapping(address => Relay) private relays;
    mapping(address => uint256) private balances;

    string public version = "1.0.0";

    function stake(address relay, uint256 unstakeDelay) external payable {
        if (relays[relay].state == RelayState.Unknown) {
            require(msg.sender != relay, "relay cannot stake for itself");
            relays[relay].owner = msg.sender;
            relays[relay].state = RelayState.Staked;

        } else if ((relays[relay].state == RelayState.Staked) || (relays[relay].state == RelayState.Registered)) {
            require(relays[relay].owner == msg.sender, "not owner");

        } else {
            revert('wrong state for stake');
        }

        // Increase the stake

        uint256 addedStake = msg.value;
        relays[relay].stake += addedStake;

        // The added stake may be e.g. zero when only the unstake delay is being updated
        require(relays[relay].stake >= minimumStake, "stake lower than minimum");

        // Increase the unstake delay

        require(unstakeDelay >= minimumUnstakeDelay, "delay lower than minimum");
        require(unstakeDelay <= maximumUnstakeDelay, "delay higher than maximum");

        require(unstakeDelay >= relays[relay].unstakeDelay, "unstakeDelay cannot be decreased");
        relays[relay].unstakeDelay = unstakeDelay;

        emit Staked(relay, relays[relay].stake, relays[relay].unstakeDelay);
    }

    function registerRelay(uint256 transactionFee, string memory url) public {
        address relay = msg.sender;

        require(relay == tx.origin, "Contracts cannot register as relays");
        require(relays[relay].state == RelayState.Staked || relays[relay].state == RelayState.Registered, "wrong state for stake");
        require(relay.balance >= minimumRelayBalance, "balance lower than minimum");

        if (relays[relay].state != RelayState.Registered) {
            relays[relay].state = RelayState.Registered;
        }

        emit RelayAdded(relay, relays[relay].owner, transactionFee, relays[relay].stake, relays[relay].unstakeDelay, url);
    }

    function removeRelayByOwner(address relay) public {
        require(relays[relay].owner == msg.sender, "not owner");
        require((relays[relay].state == RelayState.Staked) || (relays[relay].state == RelayState.Registered), "already removed");

        // Start the unstake counter
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

    function getRelay(address relay) external view returns (uint256 totalStake, uint256 unstakeDelay, uint256 unstakeTime, address payable owner, RelayState state) {
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
        require(amount <= maximumRecipientDeposit, "deposit too big");

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
    function withdraw(uint256 amount) public {
        address payable account = msg.sender;
        require(balances[account] >= amount, "insufficient funds");

        balances[account] -= amount;
        account.transfer(amount);

        emit Withdrawn(account, amount);
    }

    function getNonce(address from) view external returns (uint256) {
        return nonces[from];
    }

    function canUnstake(address relay) public view returns (bool) {
        return relays[relay].unstakeTime > 0 && relays[relay].unstakeTime <= now;
        // Finished the unstaking delay period?
    }

    function canRelay(
        address relay,
        address from,
        address to,
        bytes memory encodedFunction,
        uint256 transactionFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes memory signature,
        bytes memory approvalData
    )
    public view returns (uint256)
    {
        // Verify the sender's signature on the transaction - note that approvalData is *not* signed
        bytes memory packed = abi.encodePacked("rlx:", from, to, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, address(this));
        bytes32 hashedMessage = keccak256(abi.encodePacked(packed, relay));

        if (hashedMessage.toEthSignedMessageHash().recover(signature) != from) {
            return uint256(PreconditionCheck.WrongSignature);
        }

        // Verify the transaction is not being repalyed
        if (nonces[from] != nonce) {
            return uint256(PreconditionCheck.WrongNonce);
        }

        uint256 maxCharge = maxPossibleCharge(gasLimit, gasPrice, transactionFee);
        bytes memory encodedTx = abi.encodeWithSelector(IRelayRecipient(to).acceptRelayedCall.selector,
            relay, from, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approvalData, maxCharge
        );

        (bool success, bytes memory returndata) = to.staticcall.gas(acceptRelayedCallMaxGas)(encodedTx);

        if (!success) {
            return uint256(PreconditionCheck.AcceptRelayedCallReverted);
        } else {
            uint256 accept = abi.decode(returndata, (uint256));

            // This can be either PreconditionCheck.OK or a custom error code
            if ((accept == 0) || (accept > 10)) {
                return accept;
            } else {
                // Error codes [1-10] are reserved to RelayHub
                return uint256(PreconditionCheck.InvalidRecipientStatusCode);
            }
        }
    }

    struct MetaTxData {
        address relay;
        address from;
        address recipient;
        bytes encodedFunction;
        uint256 transactionFee;
        uint256 gasPrice;
        uint256 gasLimit;
        uint256 nonce;
        bytes signature;
        bytes approvalData;
        bytes4 functionSelector;
        uint256 maxPossibleCharge;
    }

    /**
     * @notice Relay a transaction.
     *
     * @param from the client originating the request.
     * @param recipient the target IRelayRecipient contract.
     * @param encodedFunction the function call to relay.
     * @param transactionFee fee (%) the relay takes over actual gas cost.
     * @param gasPrice gas price the client is willing to pay
     * @param gasLimit limit the client want to put on its transaction
     * @param transactionFee fee (%) the relay takes over actual gas cost.
     * @param nonce sender's nonce (in nonces[])
     * @param signature client's signature over all params except approvalData
     * @param approvalData dapp-specific data
     */
    function relayCall(
        address from,
        address recipient,
        bytes memory encodedFunction,
        uint256 transactionFee,
        uint256 gasPrice,
        uint256 gasLimit,
        uint256 nonce,
        bytes memory signature,
        bytes memory approvalData
    )
    public
    {
        uint256 initialGas = gasleft();

        MetaTxData memory metaTx = MetaTxData({
            relay: msg.sender,
            from: from,
            recipient: recipient,
            encodedFunction: encodedFunction,
            transactionFee: transactionFee,
            gasPrice: gasPrice,            gasLimit: gasLimit,
            nonce: nonce,
            signature: signature,
            approvalData: approvalData,

            functionSelector: LibBytes.readBytes4(encodedFunction, 0),
            maxPossibleCharge: maxPossibleCharge(gasLimit, gasPrice, transactionFee)
        });

        _relayCall(metaTx, initialGas);
    }

     function _relayCall(MetaTxData memory metaTx, uint256 initialGas) private {
        // Initial soundness checks - the relay must make sure these pass, or it will pay for a reverted transaction.

        // The relay must be registered
        require(relays[metaTx.relay].state == RelayState.Registered, "Unknown relay");

        // A relay may use a higher gas price than the one requested by the signer (to e.g. get the transaction in a
        // block faster), but it must not be lower. The recipient will be charged for the requested gas price, not the
        // one used in the transaction.
        require(metaTx.gasPrice <= tx.gasprice, "Invalid gas price");

        // This transaction must have enough gas to forward the call to the recipient with the requested amount, and not
        // run out of gas later in this function.
        require(SafeMath.sub(initialGas, metaTx.gasLimit) >= gasReserve, "Not enough gasleft()");

        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(metaTx.gasPrice * initialGas <= balances[metaTx.recipient], "Recipient balance too low");

        {
            // We now verify the legitimacy of the transaction (it must be signed by the sender, and not be replayed),
            // and that the recpient will accept to be charged by it.
            uint256 preconditionCheck = canRelay(metaTx.relay, metaTx.from, metaTx.recipient, metaTx.encodedFunction, metaTx.transactionFee, metaTx.gasPrice, metaTx.gasLimit, metaTx.nonce, metaTx.signature, metaTx.approvalData);

            if (preconditionCheck != uint256(PreconditionCheck.OK)) {
                emit CanRelayFailed(metaTx.relay, metaTx.from, metaTx.recipient, metaTx.functionSelector, preconditionCheck);
                return;
            }
        }

        // From this point on, this transaction will not revert nor run out of gas, and the recipient will be charged
        // for the gas spent.

        // The sender's nonce is advanced to prevent transaction replays.
        nonces[metaTx.from]++;

        uint256 preChecksGas = initialGas - gasleft();

        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        (, bytes memory relayCallStatus) = address(this).call(abi.encodeWithSelector(this.recipientCallsAtomic.selector, metaTx, preChecksGas));
        RelayCallStatus status = abi.decode(relayCallStatus, (RelayCallStatus));

        // We know perform the actual charge calculation, based on the measured gas used
        uint256 charge = calculateCharge(
            getChargeableGas(initialGas - gasleft(), false),
            metaTx.gasPrice,
            metaTx.transactionFee
        );

        // Regardless of the outcome of the relayed transaction, the recipient is now charged.

        // We've already checked that the recipient has enough balance to pay for the relayed transaction, this is only
        // a sanity check to prevent overflows in case of bugs.
        require(balances[metaTx.recipient] >= charge, "Should not get here");
        balances[metaTx.recipient] -= charge;
        balances[relays[metaTx.relay].owner] += charge;

        emit TransactionRelayed(metaTx.relay, metaTx.from, metaTx.recipient, metaTx.functionSelector, status, charge);
    }

    function recipientCallsAtomic(
        MetaTxData memory metaTx,
        uint256 preChecksGas
    )
    public
    returns (RelayCallStatus)
    {
        uint256 atomicInitialGas = gasleft(); // A new gas measurement is performed inside recipientCallsAtomic, since
        // due to EIP150 available gas amounts cannot be directly compared across external calls

        // This external function can only be called by RelayHub itself, creating an internal transaction. Calls to the
        // recipient (preRelayedCall, the relayedCall, and postRelayedCall) are called from inside this transaction.
        require(msg.sender == address(this), "Only RelayHub should call this function");

        // If either pre or post reverts, the whole internal transaction will be reverted, reverting all side effects on
        // the recipient. The recipient will still be charged for the used gas by the relay.

        // The recipient is no allowed to withdraw balance from RelayHub during a relayed transaction. We check pre and
        // post state to ensure this doesn't happen.
        uint256 balanceBefore = balances[metaTx.recipient];

        // First preRelayedCall is executed.
        // It is the recipient's responsability to ensure, in acceptRelayedCall, that this call will not revert.
        bytes32 preReturnValue;
        {
            // Note: we open a new block to avoid growing the stack too much.
            bytes memory data = abi.encodeWithSelector(
                IRelayRecipient(metaTx.recipient).preRelayedCall.selector,
                metaTx.relay, metaTx.from, metaTx.encodedFunction, metaTx.transactionFee, metaTx.gasPrice, metaTx.gasLimit, metaTx.maxPossibleCharge
            );

            (bool success, bytes memory retData) = metaTx.recipient.call.gas(preRelayedCallMaxGas)(data);

            if (!success) {
                revertWithStatus(RelayCallStatus.PreRelayedFailed);
            }

            preReturnValue = abi.decode(retData, (bytes32));
        }

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data
        (bool relayedCallSuccess,) = metaTx.recipient.call.gas(metaTx.gasLimit)(abi.encodePacked(metaTx.encodedFunction, metaTx.from));

        // We now determine how much the recipient will be charged, to pass this value to postRelayedCall for accurate
        // accounting.
        uint256 estimatedCharge = calculateCharge(
            getChargeableGas(preChecksGas + atomicInitialGas - gasleft(), true), // postRelayedCall is included in the charge
            metaTx.gasPrice,
            metaTx.transactionFee
        );

        // Finally, postRelayedCall is executed, with the relayedCall execution's status.
        {
            bytes memory data = abi.encodeWithSelector(
                IRelayRecipient(metaTx.recipient).postRelayedCall.selector,
                metaTx.relay, metaTx.from, metaTx.encodedFunction, metaTx.transactionFee, metaTx.gasPrice, metaTx.gasLimit, metaTx.maxPossibleCharge, estimatedCharge, relayedCallSuccess, preReturnValue
            );

            (bool successPost,) = metaTx.recipient.call.gas(postRelayedCallMaxGas)(data);

            if (!successPost) {
                revertWithStatus(RelayCallStatus.PostRelayedFailed);
            }
        }

        if (balances[metaTx.recipient] < balanceBefore) {
            revertWithStatus(RelayCallStatus.RecipientBalanceChanged);
        }

        return relayedCallSuccess ? RelayCallStatus.OK : RelayCallStatus.RelayedCallFailed;
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
        return gasOverhead + gasReserve + acceptRelayedCallMaxGas + preRelayedCallMaxGas + postRelayedCallMaxGas + relayedCallStipend;
    }

    function maxPossibleCharge(uint256 relayedCallStipend, uint256 gasPrice, uint256 transactionFee) public view returns (uint256) {
        return calculateCharge(requiredGas(relayedCallStipend), gasPrice, transactionFee);
    }

    function calculateCharge(uint256 gas, uint256 gasPrice, uint256 fee) private pure returns (uint256) {
        // The fee is expressed as a percentage. E.g. a value of 40 stands for a 40% fee, so the recipient will be
        // charged for 1.4 times the spent amount.
        return (gas * gasPrice * (100 + fee)) / 100;
    }

    function getChargeableGas(uint256 gasUsed, bool postRelayedCallEstimation) private pure returns (uint256) {
        return gasOverhead + gasUsed + (postRelayedCallEstimation ? (postRelayedCallMaxGas + recipientCallsAtomicOverhead) : 0);
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
        (transaction.nonce, transaction.gasPrice, transaction.gasLimit, transaction.to, transaction.value, transaction.data) = RLPReader.decodeTransaction(rawTransaction);
        return transaction;

    }

    function penalizeRepeatedNonce(bytes memory unsignedTx1, bytes memory signature1, bytes memory unsignedTx2, bytes memory signature2) public {
        // Can be called by anyone.
        // If a relay attacked the system by signing multiple transactions with the same nonce (so only one is accepted), anyone can grab both transactions from the blockchain and submit them here.
        // Check whether unsignedTx1 != unsignedTx2, that both are signed by the same address, and that unsignedTx1.nonce == unsignedTx2.nonce.  If all conditions are met, relay is considered an "offending relay".
        // The offending relay will be unregistered immediately, its stake will be forfeited and given to the address who reported it (msg.sender), thus incentivizing anyone to report offending relays.
        // If reported via a relay, the forfeited stake is split between msg.sender (the relay used for reporting) and the address that reported it.

        address addr1 = keccak256(abi.encodePacked(unsignedTx1)).recover(signature1);
        address addr2 = keccak256(abi.encodePacked(unsignedTx2)).recover(signature2);

        require(addr1 == addr2, "Different signer");

        Transaction memory decodedTx1 = decodeTransaction(unsignedTx1);
        Transaction memory decodedTx2 = decodeTransaction(unsignedTx2);

        //checking that the same nonce is used in both transaction, with both signed by the same address and the actual data is different
        // note: we compare the hash of the tx to save gas over iterating both byte arrays
        require(decodedTx1.nonce == decodedTx2.nonce, "Different nonce");

        bytes memory dataToCheck1 = abi.encodePacked(decodedTx1.data, decodedTx1.gasLimit, decodedTx1.to, decodedTx1.value);
        bytes memory dataToCheck2 = abi.encodePacked(decodedTx2.data, decodedTx2.gasLimit, decodedTx2.to, decodedTx2.value);
        require(keccak256(dataToCheck1) != keccak256(dataToCheck2), "tx is equal");

        penalize(addr1);
    }

    function penalizeIllegalTransaction(bytes memory unsignedTx, bytes memory signature) public {
        Transaction memory decodedTx = decodeTransaction(unsignedTx);
        if (decodedTx.to == address(this)) {
            bytes4 selector = GsnUtils.getMethodSig(decodedTx.data);
            // Note: If RelayHub's relay API is extended, the selectors must be added to the ones listed here
            require(selector != this.relayCall.selector && selector != this.registerRelay.selector, "Legal relay transaction");
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
