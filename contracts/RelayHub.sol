pragma solidity ^0.5.5;

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
    uint256 constant public minimumStake = 1 ether;

    // Minimum unstake delay. A relay needs to wait for this time to elapse after deregistering to retrieve its stake.
    uint256 constant public minimumUnstakeDelay = 1 weeks;
    // Maximum unstake delay. Prevents relays from locking their funds into the RelayHub for too long.
    uint256 constant public maximumUnstakeDelay = 12 weeks;

    // Minimum balance required for a relay to register or re-register. Prevents user error in registering a relay that
    // will not be able to immediatly start serving requests.
    uint256 constant public minimumRelayBalance = 0.1 ether;

    // Maximum funds that can be deposited at once. Prevents user error by disallowing large deposits.
    uint256 constant public maximumRecipientDeposit = 2 ether;

    /**
    * the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */
    uint256 constant public gasReserve = 100000; // how much reserve we actually need, to complete the post-call part of relayCall().
    uint256 constant public gasOverhead = 48120;

    // Gas stipends for acceptRelayedCall, preRelayedCall and postRelayedCall
    uint256 constant public acceptRelayedCallMaxGas = 50000;
    uint256 constant public preRelayedCallMaxGas = 100000;
    uint256 constant public postRelayedCallMaxGas = 100000;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) public nonces;

    // States a relay can be in
    enum RelayState {
        Unknown,    // The relay is unknown to the system: it has never been staked for
        Staked,     // The relay has been staked for, but it is not yet active
        Registered, // The relay has registered itself, and is active (can relay calls)
        Removing,   // The relay has been deregistered by its owner and can no longer relay calls. It must wait for its unstakeDelay to elapse before it can unstake
        Removed,    // The deregistered relay has been unstaked, and it can no longer be used in the system
        Penalized   // The relay has been penalized for misbehavior, its stake was removed and it can no longer be used in the system
    }

    enum AtomicRecipientCallsStatus {OK, CanRelayFailed, RelayedCallFailed, PreRelayedFailed, PostRelayedFailed}

    struct Relay {
        uint256 stake;          // Ether staked for this relay
        uint256 unstakeDelay;   // Time that must elapse before the owner can retrieve the stake after calling remove
        uint256 unstakeTime;    // Time when unstake will be callable. A value of zero indicates the relay has not been removed.
        address payable owner;  // Relay's owner, will receive revenue and manage it (call stake, remove and unstake).
        uint256 transactionFee; // Advertised transaction fee, not enforced
        RelayState state;
    }

    mapping(address => Relay) public relays;
    mapping(address => uint256) public balances;

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

        emit Staked(relay, addedStake);
    }

    function ownerOf(address relay) external view returns (address) {
        return relays[relay].owner;
    }

    function stakeOf(address relay) external view returns (uint256) {
        return relays[relay].stake;
    }

    function registerRelay(uint256 transactionFee, string memory url) public {
        address relay = msg.sender;

        require(relay == tx.origin, "Contracts cannot register as relays");
        require(relays[relay].state == RelayState.Staked || relays[relay].state == RelayState.Registered, "wrong state for stake");
        require(relay.balance >= minimumRelayBalance, "balance lower than minimum");

        relays[relay].state = RelayState.Registered;
        relays[relay].transactionFee = transactionFee; // This is stored, but not enforced in relayCall

        emit RelayAdded(relay, relays[relay].owner, transactionFee, relays[relay].stake, relays[relay].unstakeDelay, url);
    }

    function removeRelayByOwner(address relay) public {
        require(relays[relay].owner == msg.sender, "not owner");
        require((relays[relay].state == RelayState.Staked) || (relays[relay].state == RelayState.Registered), "already removed");

        // Start the unstake counter
        relays[relay].unstakeTime = relays[relay].unstakeDelay + now;
        relays[relay].state = RelayState.Removing;

        emit RelayRemoved(relay, relays[relay].unstakeTime);
    }

    function unstake(address relay) public {
        require(relays[relay].state != RelayState.Removed, "Already unstaked");

        require(canUnstake(relay), "canUnstake failed");
        require(relays[relay].owner == msg.sender, "not owner");

        relays[relay].state = RelayState.Removed;

        uint256 toTransfer = relays[relay].stake;
        relays[relay].stake = 0;

        relays[relay].owner.transfer(toTransfer);

        emit Unstaked(relay, toTransfer);
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

        emit Deposited(target, amount);
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

        bytes memory encodedTx = abi.encodeWithSelector(IRelayRecipient(to).acceptRelayedCall.selector,
            relay, from, encodedFunction, gasPrice, transactionFee, signature, approvalData
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

        // Initial soundness checks - the relay must make sure these pass, or it will pay for a reverted transaction.

        // The relay must be registered
        require(relays[msg.sender].state == RelayState.Registered, "Unknown relay");

        // A relay may use a higher gas price than the one requested by the signer (to e.g. get the transaction in a
        // block faster), but it must not be lower. The recipient will be charged for the requested gas price, not the
        // one used in the transaction.
        require(gasPrice <= tx.gasprice, "Invalid gas price");

        // This transaction must have enough gas to forward the call to the recipient with the requested amount, and not
        // run out of gas later in this function.
        require(SafeMath.sub(initialGas, gasLimit) >= gasReserve, "Not enough gasleft()");

        // We don't yet know how much gas will be used by the recipient, so we make sure there are enough funds to pay
        // for the maximum possible charge.
        require(gasPrice * initialGas <= balances[recipient], "Recipient balance too low");

        bytes4 functionSelector = LibBytes.readBytes4(encodedFunction, 0);

        {
            // We now verify the legitimacy of the transaction (it must be signed by the sender, and not be replayed),
            // and that the recpient will accept to be charged by it.
            uint256 preconditionCheck = canRelay(msg.sender, from, recipient, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, signature, approvalData);

            if (preconditionCheck != uint256(PreconditionCheck.OK)) {
                emit TransactionRelayed(msg.sender, from, recipient, functionSelector, uint256(RelayCallStatus.CanRelayFailed), preconditionCheck);
                return;
            }
        }

        // From this point on, this transaction will not revert nor run out of gas, and the recipient will be charged
        // for the gas spent.

        // The sender's nonce is advanced to prevent transaction replays.
        nonces[from]++;

        // Calls to the recipient are performed atomically inside an inner transaction which may revert in case of
        // errors in the recipient. In either case (revert or regular execution) the return data encodes the
        // RelayCallStatus value.
        (, bytes memory relayCallStatus) = address(this).call(abi.encodeWithSelector(this.recipientCallsAtomic.selector, from, recipient, msg.sender, encodedFunction, transactionFee, gasLimit, initialGas));
        RelayCallStatus status = abi.decode(relayCallStatus, (RelayCallStatus));

        // Regardless of the outcome of the relayed transaction, the recipient is now charged.
        uint256 charge = getChargedAmount(gasOverhead + initialGas - gasleft(), gasPrice, transactionFee);

        // We've already checked that the recipient has enough balance to pay for the relayed transaction, this is only
        // a sanity check to prevent overflows in case of bugs.
        require(balances[recipient] >= charge, "Should not get here");
        balances[recipient] -= charge;
        balances[relays[msg.sender].owner] += charge;

        emit TransactionRelayed(msg.sender, from, recipient, functionSelector, uint256(status), charge);
    }

    function getChargedAmount(uint256 gas, uint256 gasPrice, uint256 fee) private pure returns (uint256) {
        // The fee is expressed as a percentage. E.g. a value of 40 stands for a
        // 40% fee, so the recipient will be charged for 1.4 times the spent
        // amount.
        return (gas * gasPrice * (100 + fee)) / 100;
    }

    function recipientCallsAtomic(
        address from,
        address recipient,
        address relayAddr,
        bytes calldata encodedFunction,
        uint256 transactionFee,
        uint256 gasLimit,
        uint256 initialGas
    )
        external
        returns (RelayCallStatus)
    {
        // This external function can only be called by RelayHub itself, creating an internal transaction. Calls to the
        // recipient (preRelayedCall, the relayedCall, and postRelayedCall) are called from inside this transaction.
        require(msg.sender == address(this), "Only RelayHub should call this function");

        // If either pre or post reverts, the whole internal transaction will be reverted, reverting all side effects on
        // the recipient. The recipient will still be charged for the used gas by the relay.

        // The recipient is no allowed to withdraw balance from RelayHub during a relayed transaction. We check pre and
        // post state to ensure this doesn't happen.
        uint256 balanceBefore = balances[recipient];

        // First preRelayedCall is executed.
        // It is the recipient's responsability to ensure, in acceptRelayedCall, that this call will not revert.
        bytes32 preReturnValue;
        {
            // Note: we open a new block to avoid growing the stack too much.
            bytes memory data = abi.encodeWithSelector(
                IRelayRecipient(recipient).preRelayedCall.selector,
                relayAddr, from, encodedFunction, transactionFee
            );

            (bool success, bytes memory retData) = recipient.call.gas(preRelayedCallMaxGas)(data);

            if (!success) {
                revertWithStatus(RelayCallStatus.PreRelayedFailed);
            }

            preReturnValue = abi.decode(retData, (bytes32));
        }

        // The actual relayed call is now executed. The sender's address is appended at the end of the transaction data
        (bool relayedCallSuccess,) = recipient.call.gas(gasLimit)(abi.encodePacked(encodedFunction, from));

        // Even if the relayed call fails, execution continues

        uint256 gasUsed = gasOverhead + initialGas - gasleft();

        // Finally, postRelayedCall is executed, with the relayedCall execution's status.
        {
            bytes memory data = abi.encodeWithSelector(
                IRelayRecipient(recipient).postRelayedCall.selector,
                relayAddr, from, encodedFunction, relayedCallSuccess, gasUsed, transactionFee, preReturnValue
            );

            (bool successPost,) = recipient.call.gas(postRelayedCallMaxGas)(data);

            if (!successPost) {
                revertWithStatus(RelayCallStatus.PostRelayedFailed);
            }
        }

        if (balances[recipient] < balanceBefore) {
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
        // note: we compare the hash of the data to save gas over iterating both byte arrays
        require(decodedTx1.nonce == decodedTx2.nonce, "Different nonce");
        require(keccak256(abi.encodePacked(decodedTx1.data)) != keccak256(abi.encodePacked(decodedTx2.data)), "tx.data is equal");

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
        require(relays[relay].state != RelayState.Penalized, "Already penalized");

        require((relays[relay].state == RelayState.Staked) ||
            (relays[relay].state == RelayState.Registered) ||
            (relays[relay].state == RelayState.Removing), "Unstaked relay");

        if (relays[relay].state == RelayState.Registered) {
            emit RelayRemoved(relay, now);
        }

        relays[relay].state = RelayState.Penalized;

        // Half of the stake will be burned (sent to address 0), the other half
        // sent to the reporter as a reward
        uint256 toBurn = SafeMath.div(relays[relay].stake, 2);
        uint256 reward = SafeMath.sub(relays[relay].stake, toBurn);
        relays[relay].stake = 0;
        relays[relay].unstakeTime = now;

        // Ether is burned and transferred
        address(0).transfer(toBurn);
        address payable reporter = msg.sender;
        reporter.transfer(reward);

        emit Penalized(relay, reporter, reward);
    }
}
