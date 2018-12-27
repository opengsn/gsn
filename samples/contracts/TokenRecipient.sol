pragma solidity ^0.4.18;

import "../RelayRecipient.sol";

/**
 * Sample Token-based relay recipient.
 * This is a base contract for a Contract accepting incoming calls to be paid by tokens.
 * The caller doesn't have to hold any ether, but should have tokens.
 * Before each call, the caller is charged the given amount of tokens.
 * Note that this payment is valid even if the contract rejects the call.
 *
 * The relay will be unaware of this arrangement, and will get its fee in ether, as usual.
 * (the sample below is very simplistic: the amount of tokens per call is fixed, and doesn't reflect
 *  any price fluctuations or actual transaction gas cost)
 */
contract TokenRecipient is RelayRecipient {

    address token_holder;
    ERC20Interface mytoken;
    uint tx_price;

    /**
     * create this TokenRecipient
     * @param _rhub - the relay hub we're connected to.
     * @param _token_holder - account that will receive all tokens we collect from users.
     * @param _token - the ERC20 token to use.
     * @param _tx_price - amount of tokens to take for each request.
     */
    constructor(RelayHub _rhub, address _token_holder, ERC20Interface _token, uint _tx_price) public {
		init_relay_hub(_rhub);
        mytoken  = _token;
        tx_price = _tx_price;
        token_holder = _token_holder;
    }

    /**
     * validate that the user has enough tokens to make the call.
     * if he does, charge the given amount.
     * NOTE: there's a compilation warning on this method:
     *  This method is called by the relay as a view method (which obviously doesn't change anything)
     *  Later, the RelayHub calls it again, to validate the transaction on-chain, and thus perform
     *  the actual payment.
     */
    function accept_relayed_call(address /*relay*/, address from, bytes /* transaction */) public view returns(uint32) {

        //user doesn't have enough tokens. reject request.
        if ( mytoken.balanceOf(from)<tx_price ) 
            return 10;

        //failed to charge the user for tokens.
        // (note that either the user (or the token contract itself) must approve this 
        // contract to call transferFrom(), or
        if ( !mytoken.transferFrom(from, token_holder, tx_price) )
            return 11;

        //succeeded charging the user. the transaction can take place.
        return 0;
    }

}

contract ERC20Interface {
    function totalSupply() public constant returns (uint);
    function balanceOf(address tokenOwner) public constant returns (uint balance);
    function allowance(address tokenOwner, address spender) public constant returns (uint remaining);
    function transfer(address to, uint tokens) public returns (bool success);
    function approve(address spender, uint tokens) public returns (bool success);
    function transferFrom(address from, address to, uint tokens) public returns (bool success);

    event Transfer(address indexed from, address indexed to, uint tokens);
    event Approval(address indexed tokenOwner, address indexed spender, uint tokens);
}