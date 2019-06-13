pragma solidity ^0.5.5;

import "./IRelayHub.sol";
import "./IRelayRecipient.sol";
import "./GsnUtils.sol";
import "./RLPReader.sol";
import "@0x/contracts-utils/contracts/src/LibBytes.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract RelayHub is IRelayHub {

    // Anyone can call certain functions in this singleton and trigger relay processes.

    uint256 constant public minimumStake = 0.1 ether;
    uint256 constant public maximumDeposit = 2 ether;
    uint256 constant public minimumUnstakeDelay = 0;
    uint256 constant public minimumRelayBalance = 0.1 ether;  // can't register/refresh below this amount.
    uint256 constant public gasReserve = 100000; // how much reserve we actually need, to complete the post-call part of relayCall().

    /**
    * the total gas overhead of relayCall(), before the first gasleft() and after the last gasleft().
    * Assume that relay has non-zero balance (costs 15'000 more otherwise).
    */
    uint256 constant public gasOverhead = 47422;
    uint256 public acceptRelayedCallMaxGas = 50000;
    uint256 public postRelayedCallMaxGas = 100000;
    uint256 public preRelayedCallMaxGas = 100000;

    mapping(address => uint256) public nonces;    // Nonces of senders, since their ether address nonce may never change.

    enum State {UNKNOWN, STAKED, REGISTERED, REMOVED, PENALIZED}

    struct Relay {
        uint256 stake;             // Size of the stake
        uint256 unstakeDelay;     // How long between removal and unstaking
        uint256 unstakeTime;      // When is the stake released.  Non-zero means that the relay has been removed and is waiting for unstake.
        address owner;
        uint256 transactionFee;
        State state;
    }

    mapping(address => Relay) public relays;
    mapping(address => uint256) public balances;

    string public version = "1.0.0";

    function validateStake(address relay) private view {
        require(relays[relay].state == State.STAKED || relays[relay].state == State.REGISTERED, "wrong state for stake");
        require(relays[relay].stake >= minimumStake, "stake lower than minimum");
        require(relays[relay].unstakeDelay >= minimumUnstakeDelay, "delay lower than minimum");
    }

    function getNonce(address from) view external returns (uint256) {
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
        require(msg.value <= maximumDeposit, "deposit too big");
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
    function withdraw(uint256 amount) public {
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


    function stake(address relay, uint256 unstakeDelay) external payable {
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
        uint256 amount = relays[relay].stake;
        delete relays[relay];
        msg.sender.transfer(amount);
        emit Unstaked(relay, amount);
    }

    function registerRelay(uint256 transactionFee, string memory url) public {
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
        require(relays[relay].unstakeTime == 0, "already removed");

        // Start the unstake counter
        relays[relay].unstakeTime = relays[relay].unstakeDelay + now;

        if (relays[relay].state != State.PENALIZED && relays[relay].state != State.REMOVED) {
            relays[relay].state = State.REMOVED;
        }
        emit RelayRemoved(relay, relays[relay].unstakeTime);
    }

    /**
     * @notice Check if the Hub can accept a relayed operation. First the caller's signature and nonce are validated. If
     * valid, the recipient's acceptRelayedCall function is queried for recipient-specific checks.
     *
     * @return
     * - Zero if and only if the transaction can be relayed.
     * - Non-zero values up to 10 correspond to the values of CanRelayStatus enum. Refer to the enum definition for
     * documentation.
     * - Non-zero values greater than 10 are recipient-specific values.
     */
    function canRelay(address relay, address from, IRelayRecipient to, bytes memory encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes memory approval) public view returns (uint256) {
        bytes memory packed = abi.encodePacked("rlx:", from, to, encodedFunction, transactionFee, gasPrice, gasLimit, nonce, address(this));
        bytes32 hashedMessage = keccak256(abi.encodePacked(packed, relay));
        bytes32 signedMessage = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hashedMessage));

        // Verify the sender's signature on the transaction
        if (!GsnUtils.checkSig(from, signedMessage, approval)) {
            return uint256(CanRelayStatus.WrongSignature);
        }

        // Verify the transaction is not being repalyed
        if (nonces[from] != nonce) {
            return uint256(CanRelayStatus.WrongNonce);
        }

        bytes memory rawTx = abi.encodeWithSelector(to.acceptRelayedCall.selector,
            relay, from, encodedFunction, gasPrice, transactionFee, approval);

        (bool success, uint256 accept) = staticCallWithMaxGas(address(to), acceptRelayedCallMaxGas, rawTx);

        if (!success) {
            return uint256(CanRelayStatus.AcceptRelayedCallReverted);
        } else {
            // This can be either CanRelayStatus.OK, or a value outside of the enum range.
            return accept;
        }
    }

    // Due to a bug in Solidity v0.5.9 (https://github.com/ethereum/solidity/issues/6901) we need to implement this in
    // assembly.
    //
    // Once the bug is fixed, uses of this function can be replaced by:
    // (bool success, uint256 checkResult) = to.staticcall.gas(acceptRelayedCallMaxGas)(data);
    function staticCallWithMaxGas(address to, uint256 maxGas, bytes memory data) private view returns (bool, uint256) {
        bool success;
        uint256 result;

        assembly {
            let dataSize := mload(data)
            let dataPtr := add(data, 32)

            // The 32-byte result is placed memory position 0 (scratch space)
            success := staticcall(maxGas, to, dataPtr, dataSize, 0, 32)
            result := mload(0)
        }

        return (success, result);
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
    function relayCall(address from, address to, bytes memory encodedFunction, uint256 transactionFee, uint256 gasPrice, uint256 gasLimit, uint256 nonce, bytes memory approval) public {
        uint256 initialGas = gasleft();
        require(balances[to] >= gasPrice * initialGas, "Recipient balance too low");

        // Must be from a known relay
        require(relays[msg.sender].state == State.REGISTERED, "Unknown relay");

        // Relay must use the gas price set by the signer
        require(gasPrice <= tx.gasprice, "Invalid gas price");

        uint256 canRelayResult = canRelay(msg.sender, from, IRelayRecipient(to), encodedFunction, transactionFee, gasPrice, gasLimit, nonce, approval);

        if (canRelayResult != 0) {
            emit TransactionRelayed(msg.sender, from, to, abi.decode(encodedFunction, (bytes4)), uint256(RelayCallStatus.CanRelayFailed), canRelayResult);
            return;
        }

        // gasReserve must be high enough to complete relayCall()'s post-call execution.
        require(SafeMath.sub(initialGas, gasLimit) >= gasReserve, "Not enough gasleft()");

        bool successPrePost;
        bytes memory relayedCallSuccess = new bytes(32);
        (successPrePost, relayedCallSuccess) = address(this).call(abi.encodeWithSelector(this.recipientCallsAtomic.selector, from, to, msg.sender, encodedFunction, transactionFee, gasLimit, initialGas));

        // We should advance the nonce here, as once we get to this point, the recipient pays for the transaction whether if the relayed call is reverted or not.
        nonces[from]++;

        RelayCallStatus status = RelayCallStatus.OK;
        if (!successPrePost) {
            status = RelayCallStatus.PostRelayedFailed;
        } else if (LibBytes.readUint256(relayedCallSuccess, 0) == 2) {
            status = RelayCallStatus.PreRelayedFailed;
        } else if (LibBytes.readUint256(relayedCallSuccess, 0) == 0) {
            status = RelayCallStatus.RelayedCallFailed;
        }

        // Relay transactionFee is in %.  E.g. if transactionFee=40, payment will be 1.4*usedGas.
        uint256 charge = getChargedAmount(gasOverhead + initialGas - gasleft(), gasPrice, transactionFee);

        emit TransactionRelayed(msg.sender, from, to, abi.decode(encodedFunction, (bytes4)), uint256(status), charge);

        // We already checked at the beginning that the recipient has enough balance. This is more of a sanity check/safeMath before we substract from balance
        require(balances[to] >= charge, "Should not get here");
        balances[to] -= charge;
        balances[relays[msg.sender].owner] += charge;
    }

    function getChargedAmount(uint256 gas, uint256 gasPrice, uint256 fee) private pure returns (uint256) {
        // The fee is expressed as a percentage. E.g. a value of 40 stands for a
        // 40% fee, so the recipient will be charged for 1.4 times the spent
        // amount.
        return (gas * gasPrice * (100 + fee)) / 100;
    }

    function recipientCallsAtomic(address from, address to, address relayAddr, bytes calldata encodedFunction, uint256 transactionFee, uint256 gasLimit, uint256 initialGas) external returns (uint256) {
        // This function can only be called by RelayHub.
        // In order to Revert the client's relayedCall if postRelayedCall reverts, we wrap them in one function.
        // It is external in order to catch the revert status without reverting the relayCall(), so we can still charge the recipient afterwards.

        require(msg.sender == address(this), "Only RelayHub should call this function");

        bool successPrePost;
        bytes memory preRetVal;
        bytes memory transaction = abi.encodeWithSelector(IRelayRecipient(to).preRelayedCall.selector, relayAddr, from, encodedFunction, transactionFee);
        (successPrePost,preRetVal) = to.call.gas(preRelayedCallMaxGas)(transaction);
        if (!successPrePost) {
            return 2;
        }

        uint256 balanceBefore = balances[to];

        // ensure that the last bytes of @transaction are the @from address.
        // Recipient will trust this reported sender when msg.sender is the known RelayHub.
        transaction = abi.encodePacked(encodedFunction, from);
        bool success;
        (success,) = to.call.gas(gasLimit)(transaction);

        transaction = abi.encodeWithSelector(IRelayRecipient(to).postRelayedCall.selector, relayAddr, from, encodedFunction, success, (gasOverhead + initialGas - gasleft()), transactionFee, LibBytes.readBytes32(preRetVal,0));
        // Call it with .gas to make sure we have enough gasleft() to finish the transaction even if it reverts
        (successPrePost,) = to.call.gas(postRelayedCallMaxGas)(transaction);

        require(successPrePost, "postRelayedCall reverted - reverting the relayed transaction");
        require(balanceBefore <= balances[to], "Moving funds during relayed transaction disallowed");

        return success ? 1 : 0;
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

        // compensating the sender with HALF the stake of the relay (the other half is burned)
        uint256 toBurn = SafeMath.div(relays[addr1].stake,2);
        address(0).transfer(toBurn);
        relays[addr1].stake = SafeMath.sub(relays[addr1].stake, toBurn);

        uint256 amount = relays[addr1].stake;
        // move ownership of relay
        relays[addr1].owner = msg.sender;
        relays[addr1].state = State.PENALIZED;
        emit Penalized(addr1, msg.sender, amount);
        removeRelayByOwner(addr1);
    }
}
