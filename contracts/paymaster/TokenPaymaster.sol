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

    //TODO: just expose them for debugging..
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    IUniswap public uniswap;
    IERC20 public token;

    constructor(IUniswap _uniswap) public {
        uniswap = _uniswap;
        token = IERC20(uniswap.tokenAddress());
        token.approve(address(uniswap), uint(-1));
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
     */
    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    view
    returns (uint256, bytes memory) {
        (approvalData);
        address payer = this.getPayer(relayRequest);
        uint ethMaxCharge = IRelayHub(getHubAddr()).calculateCharge(maxPossibleGas, relayRequest.gasData);
        uint tokenPreCharge = uniswap.getTokenToEthOutputPrice(ethMaxCharge);

        if (tokenPreCharge > token.balanceOf(payer)) {
            return (99, "balance too low");
        }

        if (tokenPreCharge > token.allowance(payer, address(this))) {
            return (99, "allowance too low");
        }
        tokenPreCharge = 0;

        return (0, abi.encode(payer, tokenPreCharge));
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
    ) external {
        (success, preRetVal);
        //allow self for gas estimate.
        require(msg.sender == address(relayHub) || msg.sender == address(this));
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

    //filled by calculatePostGas()
    uint public gasUsedByPostWithPreCharge;
    uint public gasUsedByPostWithoutPreCharge;

    //calculate actual cost of postRelayedCall.
    // to do so, we actually move funds, so the Paymaster must have some token balance, which can be withdrawn later.
    // note that actual charge depends on Uniswap and Token implementations
    // assumptions:
    // transfer, transferFrom where both sender and recipient are the same doesn't change gas usage.
    // we assume target's original balance is non-zero (otherwise, the transfer will cost more)
    function calculatePostGas() public onlyOwner {

        gasUsedByPostWithPreCharge = 0;
        gasUsedByPostWithoutPreCharge = 0;
        //strange: can't transferFrom(this) without approval..
        token.approve(address(this), uint(-1));

        GSNTypes.GasData memory gasData = GSNTypes.GasData(0, 1, 0, 0);
        bytes memory ctx0 = abi.encode(this, uint(0));
        //no precharge
        bytes memory ctx1 = abi.encode(this, uint(200));
        //with precharge
        uint gasinit = gasleft();
        this.postRelayedCall(ctx0, true, bytes32(0), 100, gasData);
        uint gas0 = gasleft();
        this.postRelayedCall(ctx1, true, bytes32(0), 100, gasData);
        uint gas1 = gasleft();

        gasUsedByPostWithoutPreCharge = gasinit - gas0;
        gasUsedByPostWithPreCharge = gas0 - gas1;
    }
}
