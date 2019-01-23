pragma solidity >=0.4.0 <0.6.0;

contract  RelayHubApi {

    event Staked(address indexed relay, uint stake);
    event Unstaked(address indexed relay, uint stake);

    /* RelayAdded is emitted whenever a relay [re-]registers with the RelayHub.
     * filtering on these events (and filtering out RelayRemoved events) lets the client
     * find which relays are currently registered.
     */
    event RelayAdded(address indexed relay, address indexed owner, uint transactionFee, uint stake, uint unstakeDelay, string url);

    // emitted when a relay is removed
    event RelayRemoved(address indexed relay, uint unstake_time);

    /**
     * this events is emited whenever a transaction is relayed.
     * notice that the actual function call on the target contract might be reverted - in that case, the "success"
     * flag will be set to false.
     * the client uses this event so it can report correctly transaction complete (or revert) to the application.
     * Monitoring tools can use this event to detect liveliness of clients and relays.
     */
    event TransactionRelayed(address indexed relay, address indexed from, address indexed target, bytes32 hash, bool success, uint charge);
    event Deposited(address src, uint amount);
    event Withdrawn(address dest, uint amount);
    event Penalized(address indexed relay, address sender, uint amount);

    function get_nonce(address from) view external returns (uint);
    function relay(address from, address to, bytes memory encoded_function, uint transaction_fee, uint gas_price, uint gas_limit, uint nonce, bytes memory sig) public;
    
    function depositFor(address target) public payable;
    function balanceOf(address target) external view returns (uint256);

    function stake(address relayaddr, uint unstake_delay) external payable;
    function stakeOf(address relayaddr) external view returns (uint256);
    function ownerOf(address relayaddr) external view returns (address);
}

