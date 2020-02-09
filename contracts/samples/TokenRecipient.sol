pragma solidity ^0.5.16;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import "../BaseRelayRecipient.sol";

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
contract TokenRecipient is BaseRelayRecipient {

    address public tokenHolder;
    IERC20 public mytoken;
    uint public txPrice;

    /**
     * create this TokenRecipient
     * @param _rhub - the relay hub we're connected to.
     * @param _tokenHolder - account that will receive all tokens we collect from users.
     * @param _token - the ERC20 token to use.
     * @param _txPrice - amount of tokens to take for each request.
     */
    constructor(IRelayHub _rhub, address _tokenHolder, IERC20 _token, uint _txPrice) public {
        relayHub = _rhub;
        mytoken = _token;
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
    function acceptRelayedCall(address, address from, bytes memory/* transaction */) public view returns (uint) {

        //user doesn't have enough tokens. reject request.
        if (mytoken.balanceOf(from) < txPrice)
            return 10;
        return 0;
    }

    function postRelayedCall(address, address from, bytes calldata, bool, uint, uint) external {

        //failed to charge the user for tokens.
        // (note that the user (or the token contract itself) must approve this
        // contract to call transferFrom()).
        // this transfer shouldn't fail, as we checked the balance in acceptRelayedCall(), above.
        require(mytoken.transferFrom(from, tokenHolder, txPrice));
    }
}
