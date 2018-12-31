pragma solidity ^0.4.18;

import "./RelayHubApi.sol";
import "./RelayRecipient.sol";
import "./RLPReader.sol";

contract RelayHub is RelayHubApi {

    // Anyone can call certain functions in this singleton and trigger relay processes.

    uint constant timeout = 5 days; // XXX TBD
    uint constant minimum_stake = 1;    // XXX TBD
    uint constant minimum_unstake_delay = 0;    // XXX TBD
    uint constant minimum_relay_balance = 0.5 ether;  // XXX TBD - can't register/refresh below this amount.
    uint constant low_ether = 1 ether;    // XXX TBD - relay still works, but owner should be notified to fund the relay soon.
    uint constant public gas_reserve = 99999; // XXX TBD - calculate how much reserve we actually need, to complete the post-call part of relay().
    uint constant gas_overhead = 47135;  // the total gas overhead of relay(), before the first gasleft() and after the last gasleft(). Assume that relay has non-zero balance (costs 15'000 more otherwise).

    mapping (address => uint) public nonces;    // Nonces of senders, since their ether address nonce may never change.

    struct Relay {
        uint timestamp;
        uint transaction_fee;
    }

    mapping (address => Relay) public relays;

    struct Stake {
        uint stake;             // Size of the stake
        uint unstake_delay;     // How long between removal and unstaking
        uint unstake_time;      // When is the stake released.  Non-zero means that the relay has been removed and is waiting for unstake.
        address owner;
        bool removed;
    }

    mapping (address => Stake) public stakes;
    mapping (address => uint) public balances;

    function validate_stake(address relay) private view {
        require(stakes[relay].stake >= minimum_stake,"stake lower than minimum");  // Has enough stake?
        require(stakes[relay].unstake_delay >= minimum_unstake_delay,"delay lower than minimum");  // Locked for enough time?
    }
    modifier lock_stake() {
        validate_stake(msg.sender);
        require(msg.sender.balance >= minimum_relay_balance,"balance lower than minimum");
        stakes[msg.sender].unstake_time = 0;    // Activate the lock
        _;
    }

    function safe_add(uint a, uint b) internal pure returns (uint) {
        uint256 c = a + b;
        assert(c >= a);
        return c;
    }

    function safe_sub(uint a, uint b) internal pure returns (uint) {
        assert(b <= a);
        return a - b;
    }

    function get_nonce(address from) view external returns (uint) {
        return nonces[from];
    }

    /**
     * deposit ether for a contract.
     * This ether will be used to repay relay calls into this contract.
     * Contract owner should monitor the balance of his contract, and make sure
     * to deposit more, otherwise the contract won't be able to receive relayed calls.
     * Unused deposited
     */
    function depositFor(address target) public payable {
        balances[target] += msg.value;
        require (balances[target] >= msg.value);
        emit Deposited(target, msg.value);
    }

    function deposit() public payable {
        depositFor(msg.sender);
    }

    function balanceOf(address target) external view returns (uint256) {
        return balances[target];
    }

    function stakeOf(address relay) external view returns (uint256) {
        return stakes[relay].stake;
    }

    function ownerOf(address relayaddr) external view returns (address) {
        return stakes[relayaddr].owner;
    }


    function withdraw(uint amount) public {
        require(balances[msg.sender] >= amount, "insufficient funds");
        balances[msg.sender] -= amount;
        msg.sender.transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    function stake(address relay, uint unstake_delay) external payable {
        // Create or increase the stake and unstake_delay
        require(stakes[relay].owner == address(0) || stakes[relay].owner == msg.sender, "not owner");
        stakes[relay].owner = msg.sender;
        stakes[relay].stake += msg.value;
        // Make sure that the relay doesn't decrease his delay if already registered
        require(unstake_delay >= stakes[relay].unstake_delay, "unstake_delay cannot be decreased");
        stakes[relay].unstake_delay = unstake_delay;
        validate_stake(relay);
        emit Staked(relay, msg.value);
    }

    function can_unstake(address relay) public view returns(bool) {
        // Only owner can unstake
        if (stakes[relay].owner != msg.sender) {
            return false;
        }
        if (relays[relay].timestamp != 0 || stakes[relay].unstake_time == 0)  // Relay still registered so unstake time hasn't been set
            return false;
        return stakes[relay].unstake_time <= now;  // Finished the unstaking delay period?
    }

    modifier unstake_allowed(address relay) {
        require(can_unstake(relay));
        _;
    }

    function unstake(address relay) public unstake_allowed(relay) {
        uint amount = stakes[relay].stake;
        msg.sender.transfer(stakes[relay].stake);
        delete stakes[relay];
        emit Unstaked(relay, amount);
    }

    function register_relay(uint transaction_fee, string url, address optional_relay_removal) public lock_stake {
        // Anyone with a stake can register a relay.  Apps choose relays by their transaction fee, stake size and unstake delay, optionally crossed against a blacklist.  Apps verify the relay's action in realtime.
        if (msg.sender.balance < low_ether) {
            emit NeedsFunding(msg.sender);
        }
        // Penalized relay cannot reregister
        require(!stakes[msg.sender].removed, "Penalized relay cannot reregister");
        relays[msg.sender] = Relay(now, transaction_fee);
        emit RelayAdded(msg.sender, transaction_fee, stakes[msg.sender].stake, stakes[msg.sender].unstake_delay, url);

        // @optional_relay_removal is unrelated to registration, but incentivizes relays to help purging stale relays from the list.  Providing a stale relay will cause its removal, and offset the gas price of registration.
        if (optional_relay_removal != address(0))
            remove_stale_relay(optional_relay_removal);
    }

    function remove_relay_internal(address relay) internal {
        delete relays[relay];
        stakes[relay].unstake_time = stakes[relay].unstake_delay + now;   // Start the unstake counter
        stakes[relay].removed = true;
        emit RelayRemoved(relay, stakes[relay].unstake_time);
    }

    function remove_stale_relay(address relay) public { // Trustless, assumed to be called by anyone willing to pay for the gas.  Verifies staleness.  Normally called by relays to keep the list current.
        require(relays[relay].timestamp != 0, "not a relay");  // Relay exists?
        require(relays[relay].timestamp + timeout < now, "not stale");  // Did relay send a keeplive recently?
        // Anyone can remove a stale relay.
        remove_relay_internal(relay);
    }

    modifier relay_owner(address relay) {
        require(stakes[relay].owner == msg.sender, "not owner");
        _;
    }

    function remove_relay_by_owner(address relay) public relay_owner(relay) {
        // The relay's owner can remove it at any time, to start the unstake countdown.
        remove_relay_internal(relay);
    }

    function check_sig(address signer, bytes32 hash, bytes sig) pure internal returns (bool) {
        // Check if @v,@r,@s are a valid signature of @signer for @hash
        return signer == ecrecover(hash, uint8(sig[0]), bytesToBytes32(sig,1), bytesToBytes32(sig,33));
    }

	//check if the Hub can accept this relayed operation.
	// it validates the caller's signature and nonce, and then delegates to the destination's accept_relayed_call
	// for contract-specific checks.
	// returns "0" if the relay is valid. other values represent errors.
	// values 1..10 are reserved for can_relay. other values can be used by accept_relayed_call of target contracts.
    function can_relay(address relay, address from, RelayRecipient to, bytes transaction, uint transaction_fee, uint gas_price, uint gas_limit, uint nonce, bytes sig) public view returns(uint32) {
        bytes memory packed = abi.encodePacked("rlx:", from, to, transaction, transaction_fee, gas_price, gas_limit, nonce, address(this));
        bytes32 hashed_message = keccak256(abi.encodePacked(packed, relay));
        bytes32 signed_message = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hashed_message));
        if (!check_sig(from, signed_message,  sig))  // Verify the sender's signature on the transaction
            return 1;   // @from hasn't signed the transaction properly
        if (nonces[from] != nonce)
            return 2;   // Not a current transaction.  May be a replay attempt.
        // XXX check @to's balance, roughly estimate if it has enough balance to pay the transaction fee.  It's the relay's responsibility to verify, but check here too.
        return to.accept_relayed_call(relay, from, transaction, gas_price, transaction_fee); // Check to.accept_relayed_call, see if it agrees to accept the charges.
    }

    function relay(address from, address to, bytes transaction_orig, uint transaction_fee, uint gas_price, uint gas_limit, uint nonce, bytes sig) public {
        uint initial_gas = gasleft();
        require(relays[msg.sender].timestamp > 0, "Unknown relay");  // Must be from a known relay
        require(gas_price <= tx.gasprice, "Invalid gas price");      // Relay must use the gas price set by the signer
        relays[msg.sender].timestamp = now;

        require(0 == can_relay(msg.sender, from, RelayRecipient(to), transaction_orig, transaction_fee, gas_price, gas_limit, nonce, sig), "can_relay failed");
        if (msg.sender.balance < low_ether) {
            emit NeedsFunding(msg.sender);
        }

        // // ensure that the last bytes of @transaction are the @from address.  Recipient will trust this reported sender when msg.sender is the known RelayHub.
        bytes memory transaction = abi.encodePacked(transaction_orig,from);

        // gas_reserve must be high enough to complete relay()'s post-call execution.
        require(safe_sub(initial_gas,gas_limit) >= gas_reserve, "Not enough gasleft()");
        bool success = executeCallWithGas(gas_limit, to, 0, transaction); // transaction must end with @from at this point
        nonces[from]++;
        RelayRecipient(to).post_relayed_call(msg.sender, from, transaction_orig, success, (gas_overhead+initial_gas-gasleft()), transaction_fee );
        // Relay transaction_fee is in %.  E.g. if transaction_fee=50, token payment will be equivalent to used_gas*(100+transaction_fee)*gas_price = used_gas*150*gas_price.
        uint charge = (gas_overhead+initial_gas-gasleft())*gas_price*(100+transaction_fee)/100;
        emit TransactionRelayed(msg.sender, keccak256(transaction), from, success, charge);
        require(balances[to] >= charge, "insufficient funds");
        balances[to] -= charge;
        balances[stakes[msg.sender].owner] += charge;
    }

    function executeCallWithGas(uint allowed_gas, address to, uint256 value, bytes data) internal returns (bool success) {
        assembly {
            success := call(allowed_gas, to, value, add(data, 0x20), mload(data), 0, 0)
        }
    }

    struct Transaction {
        uint nonce;
        uint gas_price;
        uint gas_limit;
        address to;
        uint value;
        bytes data;
    }

    function decode_transaction (bytes raw_transaction) private pure returns ( Transaction transaction) {
        (transaction.nonce,transaction.gas_price,transaction.gas_limit,transaction.to, transaction.value, transaction.data) = RLPReader.decode_transaction(raw_transaction);
        return transaction;

    }

    function penalize_repeated_nonce(bytes unsigned_tx1, bytes sig1 ,bytes unsigned_tx2, bytes sig2) public {
        // Can be called by anyone.  
        // If a relay attacked the system by signing multiple transactions with the same nonce (so only one is accepted), anyone can grab both transactions from the blockchain and submit them here.
        // Check whether unsigned_tx1 != unsigned_tx2, that both are signed by the same address, and that unsigned_tx1.nonce == unsigned_tx2.nonce.  If all conditions are met, relay is considered an "offending relay".
        // The offending relay will be unregistered immediately, its stake will be forfeited and given to the address who reported it (msg.sender), thus incentivizing anyone to report offending relays.
        // If reported via a relay, the forfeited stake is split between msg.sender (the relay used for reporting) and the address that reported it.

        Transaction memory decoded_tx1 = decode_transaction(unsigned_tx1);
        Transaction memory decoded_tx2 = decode_transaction(unsigned_tx2);

        bytes32 hash1 = keccak256(abi.encodePacked(unsigned_tx1));
        address addr1 = ecrecover(hash1, uint8(sig1[0]), bytesToBytes32(sig1,1), bytesToBytes32(sig1,33));

        bytes32 hash2 = keccak256(abi.encodePacked(unsigned_tx2));
        address addr2 = ecrecover(hash2, uint8(sig2[0]), bytesToBytes32(sig2,1), bytesToBytes32(sig2,33));

        //checking that the same nonce is used in both transaction, with both signed by the same address and the actual data is different
        // note: we compare the hash of the data to save gas over iterating both byte arrays
        require( decoded_tx1.nonce == decoded_tx2.nonce, "Different nonce");
        require(addr1 == addr2, "Different signer");
        require(keccak256(abi.encodePacked(decoded_tx1.data)) != keccak256(abi.encodePacked(decoded_tx2.data)), "tx.data is equal" ) ;
        // Checking that we do have addr1 as a staked relay
        require( stakes[addr1].stake > 0, "Unstaked relay" );
        // Checking that the relay wasn't penalized yet
        require(!stakes[addr1].removed, "Relay already penalized");
        // compensating the sender with the stake of the relay
        uint amount = stakes[addr1].stake;
        // move ownership of relay
        stakes[addr1].owner = msg.sender;
        emit Penalized(addr1, msg.sender, amount);
        remove_relay_by_owner(addr1);
    }

    function bytesToBytes32(bytes b, uint offset) private pure returns (bytes32) {
        bytes32 out;
        for (uint i = 0; i < 32; i++) {
            out |= bytes32(b[offset + i] & 0xFF) >> (i * 8);
        }
        return out;
    }

    function addressToBytes(address a) pure public returns (bytes b){
        assembly {
            let m := mload(0x40)
            mstore(add(m, 20), xor(0x140000000000000000000000000000000000000000, a))
            mstore(0x40, add(m, 52))
            b := m
        }
    }

}
