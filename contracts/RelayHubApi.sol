pragma solidity ^0.4.18;

contract  RelayHubApi {

    event Staked(address relay, uint stake);
    event Unstaked(address relay, uint stake);
    /*
    As per https://github.com/ethereum/go-ethereum/pull/16513; https://github.com/ethereum/go-ethereum/issues/15710
    any abi fields with underscore are changed to camelCase by abigen, so in order to parse the correct fields with go
    we change the field names to camelCase where we need them in go
    */
    event RelayAdded(address relay, uint transactionFee, uint stake, uint unstakeDelay, string url);  // relay not indexed, that's how apps learn of new relays
    event RelayRemoved(address indexed relay, uint unstake_time);  // relay is indexed, as apps need to watch for removal of relays in their pool.
    event NeedsFunding(address indexed relay);
    event TransactionRelayed(address indexed relay, bytes32 indexed hash, address from, bool ret, uint charge);
    event Deposited(address src, uint amount);
    event Withdrawn(address dest, uint amount);
    event Penalized(address relay, address sender, uint amount);

    function get_nonce(address from) view external returns (uint);
    function relay(address from, address to, bytes transaction_orig, uint transaction_fee, uint gas_price, uint gas_limit, uint nonce, bytes sig) public;
    
    function depositFor(address target) public payable;
    function balanceOf(address target) external view returns (uint256);
}

