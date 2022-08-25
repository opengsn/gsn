// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "@opengsn/contracts/src/forwarder/IForwarder.sol";
import "@opengsn/contracts/src/ERC2771Recipient.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";
import "@opengsn/contracts/src/utils/GsnUtils.sol";

import "./interfaces/IChainlinkOracle.sol";

import "./helpers/UniswapV3Helper.sol";
import "../../contracts/src/interfaces/IERC20Token.sol";

/**
 * A paymaster allowing addresses holding ERC20 tokens with 'permit' functionality
 * to pay for a GSN transaction.
 */
contract PermitERC20UniswapV3Paymaster is BasePaymaster, ERC2771Recipient {

    using SafeERC20 for IERC20Metadata;

    event Received(address indexed sender, uint256 eth);
    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 tokenActualCharge, uint256 ethActualCharge);

    struct TokenSwapData {
        IChainlinkOracle priceFeed;
        uint24 uniswapPoolFee;
        // between 0 to 1000, with 2 decimals, that is, 10 = 1%
        uint8 slippage;
        bytes4 permitMethodSignature;
        uint256 priceDivisor;
        uint256 validFromBlockNumber;
    }

    mapping(IERC20Metadata => TokenSwapData) public tokensSwapData;
    ISwapRouter public uniswap;
    IERC20Metadata[] public tokens;
    IERC20 public immutable weth;
    uint256 public gasUsedByPost;
    uint256 public tokensBlockNumber;


    // Upon reaching minHubBalance, the paymaster will deposit eth to RelayHub to reach targetHubBalance
    uint256 public minHubBalance;
    uint256 public targetHubBalance;
    // Minimum eth amount, above targetHubBalance, to send to the owner
    uint256 public minWithdrawalAmount;
    // Minimum eth amount to get from a swap
    uint256 public minSwapAmount;
    uint256 public paymasterFee;

    struct PaymasterConfig {
        IERC20 weth;
        IERC20Metadata[] tokens;
        IRelayHub relayHub;
        IChainlinkOracle[] priceFeeds;
        uint24[] uniswapPoolFees;
        uint8[] slippages;
        ISwapRouter uniswap;
        address trustedForwarder;
        uint256 gasUsedByPost;
        string[] permitMethodSignatures;
        uint256 minHubBalance;
        uint256 targetHubBalance;
        uint256 minWithdrawalAmount;
        uint256 minSwapAmount;
        uint256 paymasterFee;
    }

    constructor(
        PaymasterConfig memory config
    ) {
        weth = config.weth;
        setUniswap(config.uniswap);
        setMinHubBalance(config.minHubBalance);
        setTargetHubBalance(config.targetHubBalance);
        setMinWithdrawalAmount(config.minWithdrawalAmount);
        setMinSwapAmount(config.minSwapAmount);

        setPaymasterFee(config.paymasterFee);
        setRelayHub(config.relayHub);
        setPostGasUsage(config.gasUsedByPost);
        setTrustedForwarder(config.trustedForwarder);
        setTokens(config.tokens, config.priceFeeds, config.permitMethodSignatures, config.uniswapPoolFees, config.slippages);
    }

    /**
     * set gas used by postRelayedCall, for proper gas calculation.
     * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall,
     * but also the gas usage of the token and of Uniswap)
     */
    function setPostGasUsage(uint256 _gasUsedByPost) public onlyOwner {
        gasUsedByPost = _gasUsedByPost;
    }

    function setPaymasterFee(uint256 _paymasterFee) public onlyOwner {
        paymasterFee = _paymasterFee;
    }

    function setMinHubBalance(uint256 _minHubBalance) public onlyOwner {
        minHubBalance = _minHubBalance;
    }

    function setTargetHubBalance(uint256 _targetHubBalance) public onlyOwner {
        targetHubBalance = _targetHubBalance;
    }

    function setMinWithdrawalAmount(uint256 _minWithdrawalAmount) public onlyOwner {
        minWithdrawalAmount = _minWithdrawalAmount;
    }

    function setMinSwapAmount(uint256 _minSwapAmount) public onlyOwner {
        minSwapAmount = _minSwapAmount;
    }

    function setUniswap(ISwapRouter _uniswap) public onlyOwner {
        uniswap = _uniswap;
    }

    function setTokens(
        IERC20Metadata[] memory _tokens,
        IChainlinkOracle[] memory _priceFeeds,
        string[] memory _permitMethodSignatures,
        uint24[] memory _poolFees,
        uint8[] memory _slippages) public onlyOwner {
        tokens = _tokens;
        uint256 blockNumber = block.number;
        tokensBlockNumber = blockNumber;
        // allow uniswap to transfer from paymaster balance
        for (uint256 i = 0; i < tokens.length; i++) {
            TokenSwapData memory data;
            IERC20Metadata token = tokens[i];
            token.approve(address(uniswap), type(uint256).max);
            data.priceDivisor = 10 ** uint256(_priceFeeds[i].decimals() + token.decimals());
            data.priceFeed = _priceFeeds[i];
            data.permitMethodSignature = bytes4(keccak256(bytes(_permitMethodSignatures[i])));
            data.uniswapPoolFee = _poolFees[i];
            require(_slippages[i] <= 1000, "slippage above 100%");
            data.slippage = _slippages[i];
            data.validFromBlockNumber = blockNumber;
            tokensSwapData[token] = data;
        }
    }

    function getTokens() public view returns (IERC20Metadata[] memory){
        return tokens;
    }

    function getTokenSwapData(IERC20Metadata token) public view returns (TokenSwapData memory) {
        return tokensSwapData[token];
    }

    function refillHubDeposit(uint256 amount) public payable onlyOwner {
        _refillHubDeposit(amount);
    }

    function withdrawTokens(IERC20Metadata[] calldata _tokens, address target, uint256[] calldata amounts) public onlyOwner {
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tokens[i].safeTransfer(target, amounts[i]);
        }
    }

    function _calculateCharge(
        GsnTypes.RelayData calldata relayData,
        uint256 gasUsed,
        uint256 priceQuote,
        uint256 priceDivisor
    ) internal
    view
    returns (uint256 tokenCharge, uint256 ethCharge) {
        ethCharge = relayHub.calculateCharge(gasUsed, relayData);
        tokenCharge = addPaymasterFee(_weiToToken(ethCharge, priceDivisor, priceQuote));
    }

    function _tokenToWei(uint256 amount, uint256 divisor, uint256 quote) internal pure returns(uint256) {
        return 1e18 * amount * quote / divisor;
    }

    function _weiToToken(uint256 amount, uint256 divisor, uint256 quote) internal pure returns (uint256) {
        return amount * divisor / quote / 1e18;
    }
    // solhint-disable-next-line no-empty-blocks
    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {}

    function isTokenSupported(IERC20Metadata token) public view returns (bool) {
        return tokensSwapData[token].validFromBlockNumber == tokensBlockNumber;
    }

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    returns (bytes memory, bool) {
        (signature, approvalData);
        uint256 paymasterDataLength = relayRequest.relayData.paymasterData.length;
        // paymasterData must contain the token address, and optionally a a valid "permit" call on the token.
        require(paymasterDataLength >= 20, "must contain token address");
        IERC20Metadata token = _getTokenFromPaymasterData(relayRequest.relayData.paymasterData);
        require(isTokenSupported(token),"unsupported token");
        TokenSwapData memory tokenSwapData = tokensSwapData[token];
        if (paymasterDataLength != 20) {
            require(paymasterDataLength >= 24, "must contain \"permit\" and token");
            require(
                tokenSwapData.permitMethodSignature == GsnUtils.getMethodSig(relayRequest.relayData.paymasterData[20:]),
                "wrong \"permit\" method sig");
            // execute permit method for this token
            {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, bytes memory ret) = address(token).call(relayRequest.relayData.paymasterData[20:]);
                require(success, string(abi.encodePacked("permit call reverted:", string(ret))));
            }
        }

        uint256 priceQuote = uint256(tokenSwapData.priceFeed.latestAnswer());

        (uint256 tokenPreCharge,) = _calculateCharge(relayRequest.relayData, maxPossibleGas, priceQuote, tokenSwapData.priceDivisor);
        address payer = relayRequest.request.from;
        token.safeTransferFrom(payer, address(this), tokenPreCharge);
        return (abi.encode(payer, priceQuote, tokenPreCharge), false);
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
        (address payer, uint256 priceQuote, uint256 tokenPreCharge) = abi.decode(context, (address, uint256, uint256));
        IERC20Metadata token = _getTokenFromPaymasterData(relayData.paymasterData);
        (uint256 tokenActualCharge, uint256 ethActualCharge) = _calculateCharge(relayData, gasUseWithoutPost + gasUsedByPost, priceQuote, tokensSwapData[token].priceDivisor);
        require(tokenActualCharge <= tokenPreCharge, "actual charge higher");
        token.safeTransfer(payer, tokenPreCharge - tokenActualCharge);

        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, tokenActualCharge, ethActualCharge);
        _refillHubDepositIfNeeded(ethActualCharge);
        _withdrawToOwnerIfNeeded();
    }

    function _refillHubDepositIfNeeded(uint256 ethActualCharge) private {
        uint256 hubBalance = relayHub.balanceOf(address(this));
        if (hubBalance >= minHubBalance + ethActualCharge) {
            return;
        }
        uint256 depositAmount = targetHubBalance - hubBalance + ethActualCharge;
        _refillHubDeposit(depositAmount);
    }

    function _refillHubDeposit(uint256 depositAmount) private {
        uint256 balance = address(this).balance;
        uint256 amountSwapped = 0;
        if (balance < depositAmount) {
            for (uint256 i = 0; i < tokens.length && balance + amountSwapped < depositAmount; i++) {
                IERC20Metadata tokenIn = tokens[i];
                uint256 tokenBalance = tokenIn.balanceOf(address(this));
                if (tokenBalance > 0) {
                    TokenSwapData memory tokenSwapData = tokensSwapData[tokenIn];
                    uint256 quote = uint256(tokenSwapData.priceFeed.latestAnswer());
                    uint256 amountOutMin = addSlippage(_tokenToWei(tokenBalance, tokenSwapData.priceDivisor, quote), tokenSwapData.slippage);
                    if (amountOutMin < minSwapAmount) {
                        continue;
                    }
                    uint256 amountOut = UniswapV3Helper.swapToToken(
                        address(tokenIn),
                        address(weth),
                        tokenBalance,
                        amountOutMin,
                        tokenSwapData.uniswapPoolFee,
                        uniswap
                    );
                    amountSwapped += amountOut;
                }
            }
            if (amountSwapped > 0) {
                UniswapV3Helper.unwrapWeth(uniswap, amountSwapped);
            }
        }
        if (balance + amountSwapped > 0) {
            relayHub.depositFor{value : balance + amountSwapped}(address(this));
        }
    }

    function _withdrawToOwnerIfNeeded() private {
        uint256 hubBalance = relayHub.balanceOf(address(this));
        if (hubBalance >= minWithdrawalAmount + targetHubBalance) {
        relayHub.withdraw(payable(owner()), hubBalance - targetHubBalance);
        }
    }

    function _getTokenFromPaymasterData(bytes calldata paymasterData) internal pure returns (IERC20Metadata) {
        return IERC20Metadata(address(bytes20(paymasterData[:20])));
    }

    function addPaymasterFee(uint256 charge) public view returns (uint256) {
        return charge * (100 + paymasterFee) / 100;
    }

    function addSlippage(uint256 amount, uint8 slippage) public pure returns (uint256) {
        return amount * (1000 - slippage) / 1000;
    }

    // as this Paymaster already has a permission from a user to operate the tokens on behalf of the gasless account,
    // it makes this same Paymaster a great recipient of a transaction if its only action is a pure token transfer
    function transferToken(IERC20Metadata token, address target, uint256 value) external {
        require(msg.sender == getTrustedForwarder(), "must be a meta-tx");
        token.safeTransferFrom(_msgSender(), target, value);
    }

    receive() external override payable {
        emit Received(msg.sender, msg.value);
    }

    function getGasAndDataLimits() public override pure returns (IPaymaster.GasAndDataLimits memory limits) {
        return IPaymaster.GasAndDataLimits(
            2e5,
            2e5,
            4e5,
            CALLDATA_SIZE_LIMIT
        );
    }

    function versionPaymaster() external override virtual view returns (string memory){
        return "3.0.0-beta.0+opengsn.permit-erc20-uniswap-v3.ipaymaster";
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
