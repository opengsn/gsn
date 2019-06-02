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

    address tokenHolder;
    ERC20Interface mytoken;
    uint txPrice;

    /**
     * create this TokenRecipient
     * @param _rhub - the relay hub we're connected to.
     * @param _tokenHolder - account that will receive all tokens we collect from users.
     * @param _token - the ERC20 token to use.
     * @param _txPrice - amount of tokens to take for each request.
     */
    constructor(RelayHub _rhub, address _tokenHolder, ERC20Interface _token, uint _txPrice) public {
		setRelayHub(_rhub);
        mytoken  = _token;
        txPrice = _txPrice;
        tokenHolder = _tokenHolder;
    }

    /**
     * validate that the user has enough tokens to make the call.
     * if he does, charge the given amount.
     * NOTE: there's a compilation warning on this method:
     *  This method is called by the relay as a view method (which obviously doesn't change anything)
     *  Later, the RelayHub calls it again, to validate the transaction on-chain, and thus perform
     *  the actual payment.
     */
    function acceptRelayedCall(address /*relay*/, address from, bytes /* transaction */) public view returns(uint) {

        //user doesn't have enough tokens. reject request.
        if ( mytoken.balanceOf(from)< txPrice)
            return 10;
        return 0;
    }

    function postRelayedCall(address /*relay*/, address from, bytes /*encodedFunction*/, bool /*success*/, uint /*usedGas*/, uint /*transactionFee*/ ) external {

        //failed to charge the user for tokens.
        // (note that the user (or the token contract itself) must approve this 
        // contract to call transferFrom()).
        // this transfer shouldn't fail, as we checked the balance in acceptRelayedCall(), above.
        require( mytoken.transferFrom(from, tokenHolder, txPrice) );
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