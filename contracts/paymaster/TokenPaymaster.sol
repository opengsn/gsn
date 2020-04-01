pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./IUniswap.sol";
import "../BasePaymaster.sol";

/**
 * A Token-based paymaster.
 * - each request is paid for by the caller.
 * - acceptRelayedCall - verify the caller can pay for the request in tokens.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract TokenPaymaster is BasePaymaster {

    IUniswap public uniswap;
    IERC20 public token;

    //filled by calculatePostGas()
    uint public gasUsedByPostWithPreCharge;
    uint public gasUsedByPostWithoutPreCharge;

    constructor(IUniswap _uniswap) public {
        uniswap = _uniswap;
        token = IERC20(uniswap.tokenAddress());
        token.approve(address(uniswap), uint(-1));
    }

    /**
     * set gas used by postRelayedCall, for proper gas calculation.
     * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall,
     * but also the gas usage of the token and of Uniswap)
     */
    function setPostGasUsage(uint _gasUsedByPostWithPreCharge, uint _gasUsedByPostWithoutPreCharge) external onlyOwner {
        gasUsedByPostWithPreCharge = _gasUsedByPostWithPreCharge;
        gasUsedByPostWithoutPreCharge = _gasUsedByPostWithoutPreCharge;
    }

    //return the payer of this request.
    // for account-based target, this is the target account.
    function getPayer(GSNTypes.RelayRequest calldata relayRequest) external pure returns (address) {
        return relayRequest.target;
    }

    event Received(uint eth);
    function() external payable {
        emit Received(msg.value);
    }

    /**
     * verify that payer can pay for the transaction: must have balance, and also allownce for
     * this paymaster to use it.
     * NOTE: A sub-class can also allow transactions that can't be pre-paid, e.g. create transaction or
     *  a proxy call to token.approve.
     *  In this case, sub-class the acceptRelayedCall to verify the transaction, and set a tokenPreCharge to zero.
     *  The methods preRelayedCall, postRelayedCall already handle such zero tokenPreCharge.
     */
    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    view
    returns (bytes memory context) {
        (approvalData);
        address payer = this.getPayer(relayRequest);
        uint ethMaxCharge = IRelayHub(getHubAddr()).calculateCharge(maxPossibleGas, relayRequest.gasData);
        uint tokenPreCharge = uniswap.getTokenToEthOutputPrice(ethMaxCharge);

        require(tokenPreCharge < token.balanceOf(payer), "balance too low");

        require(tokenPreCharge < token.allowance(payer, address(this)), "allowance too low");
        return abi.encode(payer, tokenPreCharge);
    }

    function preRelayedCall(bytes calldata context) external relayHubOnly returns (bytes32) {
        (address payer, uint tokenPrecharge) = abi.decode(context, (address, uint));

        if (tokenPrecharge != 0) {
            token.transferFrom(payer, address(this), tokenPrecharge);
        }
        return bytes32(0);
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        bytes32 preRetVal,
        uint256 gasUseWithoutPost,
        GSNTypes.GasData calldata gasData
    ) external relayHubOnly {
        (success, preRetVal);

        (address payer, uint tokenPrecharge) = abi.decode(context, (address, uint));
        uint ethActualCharge;
        uint justPost;
        uint tokenActualCharge;

        if (tokenPrecharge == 0) {
            justPost = gasUsedByPostWithoutPreCharge;
            ethActualCharge = IRelayHub(getHubAddr()).calculateCharge(gasUseWithoutPost + justPost, gasData);
            tokenActualCharge = uniswap.getTokenToEthOutputPrice(ethActualCharge);

            //no precharge. we pay now entire sum.
            require(token.transferFrom(payer, address(this), tokenActualCharge), "failed transfer");
        } else {
            justPost = gasUsedByPostWithoutPreCharge;
            ethActualCharge = IRelayHub(getHubAddr()).calculateCharge(gasUseWithoutPost + justPost, gasData);
            tokenActualCharge = uniswap.getTokenToEthOutputPrice(ethActualCharge);

            //refund payer
            require(token.transfer(payer, tokenPrecharge - tokenActualCharge), "failed refund");
        }
        //solhint-disable-next-line
        uniswap.tokenToEthSwapOutput(ethActualCharge, uint(-1), block.timestamp+60*15);
        relayHub.depositFor.value(ethActualCharge)(address(this));
        emit TokensCharged(gasUseWithoutPost, ethActualCharge, tokenActualCharge);
    }

    event TokensCharged(uint gasUseWithoutPost, uint ethActualCharge, uint tokenActualCharge);
}
