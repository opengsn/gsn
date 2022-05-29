// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "@opengsn/contracts/src/forwarder/IForwarder.sol";
import "@opengsn/contracts/src/ERC2771Recipient.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";
import "@opengsn/contracts/src/utils/GsnUtils.sol";

import "./interfaces/IChainlinkOracle.sol";

import "./helpers/UniswapV3Helper.sol";
import "./helpers/PermitInterfaceDAI.sol";

/**
 * A paymaster allowing addresses holding ERC20 tokens with 'permit' functionality
 * to pay for a GSN transaction.
 */
contract PermitERC20UniswapV3Paymaster is BasePaymaster, ERC2771Recipient {

    using SafeERC20 for IERC20;

    event Received(address indexed sender, uint256 eth);
    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 tokenActualCharge, uint256 ethActualCharge);
    IChainlinkOracle public immutable priceFeed;

    // priceDivisor = 10 ** priceFeed.decimals()
    uint256 public immutable priceDivisor;

    ISwapRouter public immutable uniswap;
    IERC20 public immutable token;
    IERC20 public immutable weth;

    uint24 public immutable uniswapPoolFee;
    uint256 public gasUsedByPost;
    bytes4 public immutable permitMethodSignature;

    //minimum deposit in paymaster. below this value, we automatically refill by swapping tokens.
    uint public immutable ethMinDeposit;

    //value of refill the paymaster if the deposit is below the above minimum (by swapping tokens)
    uint public immutable ethDepositSwapTarget;

    constructor(
        IERC20 _weth,
        IERC20 _token,
        IRelayHub _relayHub,
        ISwapRouter _uniswap,
        IChainlinkOracle _priceFeed,
        address _trustedForwarder,
        uint24 _uniswapPoolFee,
        uint256 _gasUsedByPost,
        string memory _permitMethodSignature,
        uint256 _ethMinDeposit,
        uint256 _ethDepositSwapTarget
    ) {
        weth = _weth;
        token = _token;
        uniswap = _uniswap;
        priceFeed = _priceFeed;
        uniswapPoolFee = _uniswapPoolFee;
        permitMethodSignature = bytes4(keccak256(bytes(_permitMethodSignature)));

        ethMinDeposit = _ethMinDeposit;
        ethDepositSwapTarget = _ethDepositSwapTarget;

        priceDivisor = 10 ** uint256(priceFeed.decimals());

        setRelayHub(_relayHub);
        setPostGasUsage(_gasUsedByPost);
        setTrustedForwarder(_trustedForwarder);
        // allow uniswap to transfer from paymaster balance
        token.approve(address(uniswap), type(uint256).max);
    }

    /**
     * set gas used by postRelayedCall, for proper gas calculation.
     * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall,
     * but also the gas usage of the token and of Uniswap)
     */
    function setPostGasUsage(uint256 _gasUsedByPost) public onlyOwner {
        gasUsedByPost = _gasUsedByPost;
    }

    function _calculatePreCharge(
        GsnTypes.RelayRequest calldata relayRequest,
        uint256 maxPossibleGas,
        uint priceQuote)
    internal
    view
    returns (uint256 tokenPreCharge) {
        uint256 ethMaxCharge =
            relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData);
        tokenPreCharge = ethMaxCharge * priceQuote / priceDivisor;
    }

    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {}

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (signature, approvalData);

        // if paymasterData exists, it must contain a valid "permit" call on the token.
        if (relayRequest.relayData.paymasterData.length != 0) {
            require(relayRequest.relayData.paymasterData.length >= 4, "paymastaData: must contain \"permit\"");
            require(
                permitMethodSignature == GsnUtils.getMethodSig(relayRequest.relayData.paymasterData),
                "paymasterData: wrong \"permit\" method sig");
            // execute permit method for this token
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory ret) = address(token).call(relayRequest.relayData.paymasterData);
            require(success, string(abi.encodePacked("permit call reverted:", string(ret))));
        }

        uint256 priceQuote = uint256(priceFeed.latestAnswer());

        uint256 tokenPreCharge = _calculatePreCharge(relayRequest, maxPossibleGas, priceQuote);
        address payer = relayRequest.request.from;
        token.safeTransferFrom(payer, address(this), tokenPreCharge);
        return (abi.encode(payer, priceQuote, tokenPreCharge), true);
    }

    function _postRelayedCall(
        bytes calldata context,
        bool,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal
    override
    {
        (address payer, uint priceQuote, uint tokenPreCharge) = abi.decode(context, (address, uint256, uint256));
        uint256 ethActualCharge = relayHub.calculateCharge(gasUseWithoutPost + gasUsedByPost, relayData);
        uint256 tokenActualCharge = ethActualCharge * priceQuote / priceDivisor;
        require( tokenActualCharge < tokenPreCharge, "actual charge higher" );
        token.safeTransfer(payer, tokenPreCharge - tokenActualCharge);

        _refillHubDeposit(ethActualCharge);
        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, tokenActualCharge, ethActualCharge);
    }

    function _refillHubDeposit(uint256 ethActualCharge) private {
        if (ethMinDeposit!=0 && relayHub.balanceOf(address (this))-ethActualCharge > ethMinDeposit) {
            return;
        }
        UniswapV3Helper.swapToEth(
            address(weth),
            address(token),
            ethDepositSwapTarget,
            uniswapPoolFee,
            uniswap
        );
        relayHub.depositFor{value : address(this).balance}(address(this));
    }

    // as this Paymaster already has a permission from a user to operate the tokens on behalf of the gasless account,
    // it makes this same Paymaster a great recipient of a transaction if its only action is a pure token transfer
    function transferToken(address target, uint256 value) external {
        require(msg.sender == getTrustedForwarder(), "must be a meta-tx");
        token.safeTransferFrom(_msgSender(), target, value);
    }

    receive() external override payable {
        emit Received(msg.sender, msg.value);
    }

    function versionPaymaster() external override virtual view returns (string memory){
        return "3.0.0-alpha.5+opengsn.permit-erc20-uniswap-v3.ipaymaster";
    }

    function versionRecipient() external override virtual view returns (string memory){
        return "3.0.0-alpha.5+opengsn.permit-erc20-uniswap-v3.irelayrecipient";
    }

    function getTrustedForwarder() override(BasePaymaster, ERC2771Recipient) public view returns (address forwarder){
        forwarder = ERC2771Recipient.getTrustedForwarder();
    }

    function setTrustedForwarder(address _forwarder) public override onlyOwner {
        _setTrustedForwarder(_forwarder);
    }

    function _msgSender() internal view override(Context, ERC2771Recipient) returns (address sender) {
        sender = ERC2771Recipient._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Recipient) returns (bytes memory) {
        return ERC2771Recipient._msgData();
    }
}
