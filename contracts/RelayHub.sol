pragma solidity >=0.4.0 <0.6.0;

import "./IRelayHub.sol";
import "./IRelayRecipient.sol";
import "./GsnUtils.sol";
import "./RLPReader.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract RelayHub is IRelayHub {

    // Anyone can call certain functions in this singleton and trigger relay processes.

    uint constant minimumStake = 0.1 ether;
    uint constant minimumUnstakeDelay = 0;
    uint constant minimumRelayBalance = 0.1 ether;  // can't register/refresh below this amount.
    uint constant public gasReserve = 99999; // XXX TBD - calculate how much reserve we actually need, to complete the post-call part of relayCall().
    /**
    * the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */
    uint constant public gasOverhead = 47446;
    uint public acceptRelayedCallMaxGas = 50000;

    mapping(address => uint) public nonces;    // Nonces of senders, since their ether address nonce may never change.

    enum State {UNKNOWN, STAKED, REGISTERED, REMOVED, PENALIZED}
    // status flags for TransactionRelayed() event
    enum RelayCallStatus {OK, CanRelayFailed, RelayedCallFailed, PostRelayedFailed}
    enum CanRelayStatus {OK, WrongSignature, WrongNonce, AcceptRelayedCallUnkownError, AcceptRelayedCallReverted}

    struct Relay {
        uint stake;             // Size of the stake
        uint unstakeDelay;     // How long between removal and unstaking
        uint unstakeTime;      // When is the stake released.  Non-zero means that the relay has been removed and is waiting for unstake.
        address owner;
        uint transactionFee;
        State state;
    }

    mapping(address => Relay) public relays;
    mapping(address => uint) public balances;

    string public version = "1.0.0.0";

    function validateStake(address relay) private view {
        require(relays[relay].state == State.STAKED || relays[relay].state == State.REGISTERED, "wrong state for stake");
        require(relays[relay].stake >= minimumStake, "stake lower than minimum");
        require(relays[relay].unstakeDelay >= minimumUnstakeDelay, "delay lower than minimum");
    }

    function getNonce(address from) view external returns (uint) {
        return nonces[from];
    }

    /**
     * deposit ether for a contract.
     * This ether will be used to repay relay calls into this contract.
     * Contract owner should monitor the balance of his contract, and make sure
     * to deposit more, otherwise the contract won't be able to receive relayed calls.
     * Unused deposited can be withdrawn with `withdraw()`
     */
    function depositFor(address target) public payable {
        require(msg.value <= minimumStake, "deposit too big");
        balances[target] += msg.value;
        require(balances[target] >= msg.value);
        emit Deposited(target, msg.value);
    }

    /**
     * withdraw funds.
     * caller is either a relay owner, withdrawing collected transaction fees.
     * or a IRelayRecipient contract, withdrawing its deposit.
     * note that while everyone can `depositFor()` a contract, only
     * the contract itself can withdraw its funds.
     */
    function withdraw(uint amount) public {
        require(balances[msg.sender] >= amount, "insufficient funds");
        balances[msg.sender] -= amount;
        msg.sender.transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    //check the deposit balance of a contract.
    function balanceOf(address target) external view returns (uint256) {
        return balances[target];
    }

    function stakeOf(address relay) external view returns (uint256) {
        return relays[relay].stake;
    }

    function ownerOf(address relay) external view returns (address) {
        return relays[relay].owner;
    }


    function stake(address relay, uint unstakeDelay) external payable {
        // Create or increase the stake and unstakeDelay
        require(relays[relay].owner == address(0) || relays[relay].owner == msg.sender, "not owner");
        require(msg.sender != relay, "relay cannot stake for itself");
        relays[relay].owner = msg.sender;
        relays[relay].stake += msg.value;
        // Make sure that the relay doesn't decrease his delay if already registered
        require(unstakeDelay >= relays[relay].unstakeDelay, "unstakeDelay cannot be decreased");
        if (relays[relay].state == State.UNKNOWN) {
            relays[relay].state = State.STAKED;
        }
        relays[relay].unstakeDelay = unstakeDelay;
        validateStake(relay);
        emit Staked(relay, msg.value);
    }

    function canUnstake(address relay) public view returns (bool) {
        return relays[relay].unstakeTime > 0 && relays[relay].unstakeTime <= now;
        // Finished the unstaking delay period?
    }

    function unstake(address relay) public {
        require(canUnstake(relay), "canUnstake failed");
        require(relays[relay].owner == msg.sender, "not owner");
        uint amount = relays[relay].stake;
        delete relays[relay];
        msg.sender.transfer(amount);
        emit Unstaked(relay, amount);
    }

    function registerRelay(uint transactionFee, string memory url) public {
        // Anyone with a stake can register a relay.  Apps choose relays by their transaction fee, stake size and unstake delay,
        // optionally crossed against a blacklist.  Apps verify the relay's action in realtime.

        // Penalized relay cannot reregister
        validateStake(msg.sender);
        require(msg.sender.balance >= minimumRelayBalance, "balance lower than minimum");
        require(msg.sender == tx.origin, "Contracts cannot register as relays");
        relays[msg.sender].unstakeTime = 0;
        // Activate the lock
        relays[msg.sender].state = State.REGISTERED;
        relays[msg.sender].transactionFee = transactionFee;
        emit RelayAdded(msg.sender, relays[msg.sender].owner, transactionFee, relays[msg.sender].stake, relays[msg.sender].unstakeDelay, url);
    }

    function removeRelayByOwner(address relay) public {
        require(relays[relay].owner == msg.sender, "not owner");
        relays[relay].unstakeTime = relays[relay].unstakeDelay + now;
        // Start the unstake counter
        if (relays[relay].state != State.PENALIZED) {
            relays[relay].state = State.REMOVED;
        }
        emit RelayRemoved(relay, relays[relay].unstakeTime);
    }

    //check if the Hub can accept this relayed operation.
    // it validates the caller's signature and nonce, and then delegates to the destination's acceptRelayedCall
    // for contract-specific checks.
    // returns "0" if the relay is valid. other values represent errors.
    // values 1..10 are reserved for canRelay. other values can be used by acceptRelayedCall of target contracts.
    function canRelay(address relay, address from, IRelayRecipient to, bytes memory encodedFunction, uint transactionFee, uint gasPrice, uint gasLimit, uint nonce, bytes memory approval) public view returns (uint) {
        bytes memory packed = abi.encodePacked("rlx:", from, to, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, address(this));
        bytes32 hashedMessage = keccak256(abi.encodePacked(packed, relay));
        bytes32 signedMessage = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hashedMessage));
        if (!GsnUtils.checkSig(from, signedMessage, approval))  // Verify the sender's signature on the transaction
            return uint(CanRelayStatus.WrongSignature);
        // @from hasn't signed the transaction properly
        if (nonces[from] != nonce)
            return uint(CanRelayStatus.WrongNonce);
        // Not a current transaction.  May be a replay attempt.
        // XXX check @to's balance, roughly estimate if it has enough balance to pay the transaction fee.  It's the relay's responsibility to verify, but check here too.
        bytes memory acceptRelayedCallRawTx = abi.encodeWithSelector(to.acceptRelayedCall.selector, relay, from, encodedFunction, gasPrice, transactionFee, approval);
        return handleAcceptRelayCall(to, acceptRelayedCallRawTx);
    }

    function handleAcceptRelayCall(IRelayRecipient to, bytes memory acceptRelayedCallRawTx) private view returns (uint){
        bool success;
        uint accept = uint(CanRelayStatus.AcceptRelayedCallUnkownError);
        assembly {
            let ptr := mload(0x40)
            let acceptRelayedCallMaxGas := sload(acceptRelayedCallMaxGas_slot)
            success := staticcall(acceptRelayedCallMaxGas, to, add(acceptRelayedCallRawTx, 0x20), mload(acceptRelayedCallRawTx), ptr, 0x20)
            accept := mload(ptr)
        }
        if (!success) {
            return uint(CanRelayStatus.AcceptRelayedCallReverted);
        }
        return accept;
    }

    /**
     * relay a transaction.
     * @param from the client originating the request.
     * @param to the target IRelayRecipient contract.
     * @param encodedFunction the function call to relay.
     * @param transactionFee fee (%) the relay takes over actual gas cost.
     * @param gasPrice gas price the client is willing to pay
     * @param gasLimit limit the client want to put on its transaction
     * @param transactionFee fee (%) the relay takes over actual gas cost.
     * @param nonce sender's nonce (in nonces[])
     * @param approval client's signature over all params (first 65 bytes). The remainder is dapp-specific data.
     */
    function relayCall(address from, address to, bytes memory encodedFunction, uint transactionFee, uint gasPrice, uint gasLimit, uint nonce, bytes memory approval) public {
        uint initialGas = gasleft();
        require(relays[msg.sender].state == State.REGISTERED, "Unknown relay");
        // Must be from a known relay
        require(gasPrice <= tx.gasprice, "Invalid gas price");
        // Relay must use the gas price set by the signer
        uint canRelayResult = canRelay(msg.sender, from, IRelayRecipient(to), encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approval);
        if (canRelayResult != 0) {
            emitTransactionRelayed(msg.sender, from, to, encodedFunction, uint(RelayCallStatus.CanRelayFailed), 0);
            return;
        }

        // ensure that the last bytes of @transaction are the @from address.
        // Recipient will trust this reported sender when msg.sender is the known RelayHub.

        // gasReserve must be high enough to complete relayCall()'s post-call execution.
        require(SafeMath.sub(initialGas, gasLimit) >= gasReserve, "Not enough gasleft()");
        bool successPost;
        bytes memory ret = new bytes(32);
        (successPost, ret) = address(this).call(abi.encodeWithSelector(this.recipientCalls.selector, from, to, msg.sender, encodedFunction, transactionFee, gasLimit, initialGas));
        nonces[from]++;
        RelayCallStatus status = RelayCallStatus.OK;
        if (LibBytes.readUint256(ret, 0) == 0)
            status = RelayCallStatus.RelayedCallFailed;
        // Relay transactionFee is in %.  E.g. if transactionFee=40, payment will be 1.4*usedGas.
        uint charge = (gasOverhead + initialGas - gasleft()) * gasPrice * (100 + transactionFee) / 100;
        if (!successPost) {
            emitTransactionRelayed(msg.sender, from, to, encodedFunction, uint(RelayCallStatus.PostRelayedFailed), charge);
        } else {
            emitTransactionRelayed(msg.sender, from, to, encodedFunction, uint(status), charge);
        }
        require(balances[to] >= charge, "insufficient funds");
        balances[to] -= charge;
        balances[relays[msg.sender].owner] += charge;
    }

    // Bypassing "stack too deep"... in relayCall()
    function emitTransactionRelayed(address sender, address from, address to, bytes memory encodedFunction, uint status, uint charge) internal {
        emit TransactionRelayed(sender, from, to, LibBytes.readBytes4(encodedFunction, 0), status, charge);
    }

    function recipientCalls(address from, address to, address relayAddr, bytes calldata encodedFunction, uint transactionFee, uint gasLimit, uint initialGas) external returns (bool) {
        require(msg.sender == address(this), "Only RelayHub should call this function");

        // ensure that the last bytes of @transaction are the @from address.
        // Recipient will trust this reported sender when msg.sender is the known RelayHub.
        bytes memory transaction = abi.encodePacked(encodedFunction, from);
        bool success;
        bool successPost;
        uint balanceBefore = balances[to];
        (success,) = to.call.gas(gasLimit)(transaction);
        // transaction must end with @from at this point
        transaction = abi.encodeWithSelector(IRelayRecipient(to).postRelayedCall.selector, relayAddr, from, encodedFunction, success, (gasOverhead + initialGas - gasleft()), transactionFee);
        (successPost,) = to.call.gas((gasOverhead + initialGas - gasleft()))(transaction);
        require(successPost, "postRelayedCall reverted - reverting the relayed transaction");
        require(balanceBefore <= balances[to], "Moving funds during relayed transaction disallowed");
        return success;
    }

    struct Transaction {
        uint nonce;
        uint gasPrice;
        uint gasLimit;
        address to;
        uint value;
        bytes data;
    }

    function decodeTransaction(bytes memory rawTransaction) private pure returns (Transaction memory transaction) {
        (transaction.nonce, transaction.gasPrice, transaction.gasLimit, transaction.to, transaction.value, transaction.data) = RLPReader.decodeTransaction(rawTransaction);
        return transaction;

    }

    function penalizeRepeatedNonce(bytes memory unsignedTx1, bytes memory sig1, bytes memory unsignedTx2, bytes memory sig2) public {
        // Can be called by anyone.
        // If a relay attacked the system by signing multiple transactions with the same nonce (so only one is accepted), anyone can grab both transactions from the blockchain and submit them here.
        // Check whether unsignedTx1 != unsignedTx2, that both are signed by the same address, and that unsignedTx1.nonce == unsignedTx2.nonce.  If all conditions are met, relay is considered an "offending relay".
        // The offending relay will be unregistered immediately, its stake will be forfeited and given to the address who reported it (msg.sender), thus incentivizing anyone to report offending relays.
        // If reported via a relay, the forfeited stake is split between msg.sender (the relay used for reporting) and the address that reported it.

        Transaction memory decodedTx1 = decodeTransaction(unsignedTx1);
        Transaction memory decodedTx2 = decodeTransaction(unsignedTx2);

        bytes32 hash1 = keccak256(abi.encodePacked(unsignedTx1));
        address addr1 = ecrecover(hash1, uint8(sig1[0]), LibBytes.readBytes32(sig1, 1), LibBytes.readBytes32(sig1, 33));

        bytes32 hash2 = keccak256(abi.encodePacked(unsignedTx2));
        address addr2 = ecrecover(hash2, uint8(sig2[0]), LibBytes.readBytes32(sig2, 1), LibBytes.readBytes32(sig2, 33));

        //checking that the same nonce is used in both transaction, with both signed by the same address and the actual data is different
        // note: we compare the hash of the data to save gas over iterating both byte arrays
        require(decodedTx1.nonce == decodedTx2.nonce, "Different nonce");
        require(addr1 == addr2, "Different signer");
        require(keccak256(abi.encodePacked(decodedTx1.data)) != keccak256(abi.encodePacked(decodedTx2.data)), "tx.data is equal");
        penalizeInternal(addr1);
    }

    function penalizeIllegalTransaction(bytes memory unsignedTx1, bytes memory sig1) public {
        // Externally-owned accounts that are registered as relays are not allowed to perform
        // any transactions other than 'relay' and 'registerRelay'. They have no legitimate
        // reasons to do that, so this behaviour is too suspicious to be left unattended.
        // It is enforced by penalizing the relay for a transaction that we consider illegal.
        // Note: If you add  another valid function call to RelayHub, you must add a selector
        // of the function you would like to declare as legal!

        Transaction memory decodedTx1 = decodeTransaction(unsignedTx1);
        if (decodedTx1.to == address(this)) {
            bytes4 selector = GsnUtils.getMethodSig(decodedTx1.data);
            require(selector != this.relayCall.selector && selector != this.registerRelay.selector, "Legal relay transaction");
        }
        bytes32 hash = keccak256(abi.encodePacked(unsignedTx1));
        address addr = ecrecover(hash, uint8(sig1[0]), LibBytes.readBytes32(sig1, 1), LibBytes.readBytes32(sig1, 33));
        penalizeInternal(addr);
    }

    function penalizeInternal(address addr1) private {
        // Checking that we do have addr1 as a staked relay
        require(relays[addr1].stake > 0, "Unstaked relay");
        // Checking that the relay wasn't penalized yet
        require(relays[addr1].state != State.PENALIZED, "Relay already penalized");
        // compensating the sender with the stake of the relay
        uint amount = relays[addr1].stake;
        // move ownership of relay
        relays[addr1].owner = msg.sender;
        relays[addr1].state = State.PENALIZED;
        emit Penalized(addr1, msg.sender, amount);
        removeRelayByOwner(addr1);
    }
}
