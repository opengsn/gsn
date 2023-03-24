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

/**
 * A paymaster allowing addresses holding ERC20 tokens with 'permit' functionality
 * to pay for a GSN transaction.
 */
contract PermitERC20UniswapV3Paymaster is BasePaymaster, ERC2771Recipient {

    using SafeERC20 for IERC20;

    event Received(address indexed sender, uint256 eth);
    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 tokenActualCharge, uint256 ethActualCharge);

    struct TokenSwapData {
        IChainlinkOracle priceFeed;
        // in case the chainlink oracle exposes price quote as "ETH / Token" we need to reverse the calculation
        bool reverseQuote;
        uint24 uniswapPoolFee;
        // between 0 to 1000, with 2 decimals, that is, 10 = 1%
        uint8 slippage;
        bytes4 permitMethodSelector;
        uint256 priceDivisor;
        uint256 validFromBlockNumber;
    }

    mapping(IERC20 => TokenSwapData) public tokensSwapData;
    ISwapRouter public uniswap;
    IERC20[] public tokens;
    IERC20 public weth;
    uint256 public tokensBlockNumber;
    uint256 public gasUsedByPost;
    uint256 public minHubBalance;
    uint256 public targetHubBalance;
    uint256 public minWithdrawalAmount;
    uint256 public minSwapAmount;
    uint256 public paymasterFee;

    struct UniswapConfig {
        ISwapRouter uniswap;
        IERC20 weth;
        // Minimum eth amount to get from a swap
        uint256 minSwapAmount;
        IERC20[] tokens;
        IChainlinkOracle[] priceFeeds;
        uint24[] uniswapPoolFees;
        string[] permitMethodSignatures;
        uint8[] slippages;
        bool[] reverseQuotes;
    }

    struct GasAndEthConfig {
        /**
        * set gas used by postRelayedCall, for proper gas calculation.
        * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall,
        * but also the gas usage of the token and of Uniswap)
        */
        uint256 gasUsedByPost;
        // Upon reaching minHubBalance, the paymaster will deposit eth to RelayHub to reach targetHubBalance
        uint256 minHubBalance;
        uint256 targetHubBalance;
        // Minimum eth amount, above targetHubBalance, to send to the owner
        uint256 minWithdrawalAmount;
        uint256 paymasterFee;
    }

    constructor(
        UniswapConfig memory uniswapConfig,
        GasAndEthConfig memory gasAndEthConfig,
        address _trustedForwarder,
        IRelayHub _relayHub
    ) {
        setUniswapConfig(uniswapConfig);
        setGasAndEthConfig(gasAndEthConfig);

        setRelayHub(_relayHub);
        setTrustedForwarder(_trustedForwarder);
    }

    function setUniswapConfig(UniswapConfig memory config) public onlyOwner {
        weth = config.weth;
        uniswap = config.uniswap;
        minSwapAmount = config.minSwapAmount;
        setTokens(config.tokens, config.priceFeeds, config.permitMethodSignatures, config.uniswapPoolFees, config.reverseQuotes, config.slippages);
    }

    function setGasAndEthConfig(GasAndEthConfig memory config) public onlyOwner {
        minWithdrawalAmount = config.minWithdrawalAmount;
        gasUsedByPost = config.gasUsedByPost;
        targetHubBalance = config.targetHubBalance;
        minHubBalance = config.minHubBalance;
        paymasterFee = config.paymasterFee;
    }

    function setTokens(
        IERC20[] memory _tokens,
        IChainlinkOracle[] memory _priceFeeds,
        string[] memory _permitMethodSignatures,
        uint24[] memory _poolFees,
        bool[] memory _reverseQuote,
        uint8[] memory _slippages) private {
        tokens = _tokens;
        uint256 blockNumber = block.number;
        tokensBlockNumber = blockNumber;
        // allow uniswap to transfer from paymaster balance
        for (uint256 i = 0; i < tokens.length; i++) {
            TokenSwapData memory data;
            IERC20 token = tokens[i];
            token.approve(address(uniswap), type(uint256).max);
            data.priceDivisor = 10 ** uint256(_priceFeeds[i].decimals() + IERC20Metadata(address(token)).decimals());
            data.priceFeed = _priceFeeds[i];
            data.reverseQuote = _reverseQuote[i];
            data.permitMethodSelector = bytes4(keccak256(bytes(_permitMethodSignatures[i])));
            data.uniswapPoolFee = _poolFees[i];
            require(_slippages[i] <= 1000, "slippage above 100%");
            data.slippage = _slippages[i];
            data.validFromBlockNumber = blockNumber;
            tokensSwapData[token] = data;
        }
    }

    function getTokens() public view returns (IERC20[] memory){
        return tokens;
    }

    function getTokenSwapData(IERC20 token) public view returns (TokenSwapData memory) {
        return tokensSwapData[token];
    }

    function refillHubDeposit(uint256 amount) public payable onlyOwner {
        _refillHubDeposit(amount);
    }

    function withdrawTokens(IERC20[] calldata _tokens, address target, uint256[] calldata amounts) public onlyOwner {
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tokens[i].safeTransfer(target, amounts[i]);
        }
    }

    function _calculateCharge(
        GsnTypes.RelayData calldata relayData,
        uint256 gasUsed,
        uint256 priceQuote,
        bool reverseQuote
    ) internal
    view
    returns (uint256 tokenCharge, uint256 ethCharge) {
        ethCharge = relayHub.calculateCharge(gasUsed, relayData);
        tokenCharge = addPaymasterFee(weiToToken(ethCharge, priceQuote, reverseQuote));
    }

    function toActualQuote(uint256 quote, uint256 divisor) public pure returns (uint256) {
        // converting oracle token-to-eth answer, to token to wei (*1e18), packing divisor (/divisor) to it
        // multiplying by 1e36 to avoid loss of precision by dividing by divisor
        return 1e36 * 1e18 * quote / divisor;
    }

    function tokenToWei(uint256 amount, uint256 quote, bool reverse) public pure returns (uint256) {
        if (reverse){
            return weiToToken(amount, quote, false);
        }
        return amount * quote / 1e36;
    }

    function weiToToken(uint256 amount, uint256 quote, bool reverse) public pure returns (uint256) {
        if (reverse){
            return tokenToWei(amount, quote, false);
        }
        return amount * 1e36 / quote;
    }

    // solhint-disable-next-line no-empty-blocks
    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {}

    function isTokenSupported(IERC20 token) public view returns (bool) {
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
        bytes calldata paymasterData = relayRequest.relayData.paymasterData;
        // paymasterData must contain the token address, and optionally a a valid "permit" call on the token.
        require(paymasterData.length >= 20, "must contain token address");
        IERC20 token = _getTokenFromPaymasterData(paymasterData);
        require(isTokenSupported(token),"unsupported token");
        TokenSwapData memory tokenSwapData = tokensSwapData[token];
        if (paymasterData.length != 20) {
            require(paymasterData.length >= 24, "must contain \"permit\" and token");
            require(
                tokenSwapData.permitMethodSelector == GsnUtils.getMethodSig(paymasterData[20:]),
                "wrong \"permit\" method sig");
            // execute permit method for this token
            {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, bytes memory ret) = address(token).call(paymasterData[20:]);
                require(success, string(abi.encodePacked("permit call reverted:", string(ret))));
            }
        }

        uint256 priceQuote = toActualQuote(uint256(tokenSwapData.priceFeed.latestAnswer()),tokenSwapData.priceDivisor);

        (uint256 tokenPreCharge,) = _calculateCharge(relayRequest.relayData, maxPossibleGas, priceQuote, tokenSwapData.reverseQuote);
        address payer = relayRequest.request.from;
        token.safeTransferFrom(payer, address(this), tokenPreCharge);
        return (abi.encode(token, payer, priceQuote, tokenPreCharge, tokenSwapData.reverseQuote), false);
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
        (IERC20 token, address payer, uint256 priceQuote, uint256 tokenPreCharge, bool reverseQuote) = abi.decode(context, (IERC20, address, uint256, uint256, bool));
        (uint256 tokenActualCharge, uint256 ethActualCharge) = _calculateCharge(relayData, gasUseWithoutPost + gasUsedByPost, priceQuote, reverseQuote);
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
                amountSwapped += _maybeSwapTokenToWeth(tokens[i]);
            }
            if (amountSwapped > 0) {
                UniswapV3Helper.unwrapWeth(uniswap, amountSwapped);
            }
        }
        if (balance + amountSwapped > 0) {
            relayHub.depositFor{value : balance + amountSwapped}(address(this));
        }
    }

    function _maybeSwapTokenToWeth(IERC20 tokenIn) private returns (uint256) {
        uint256 tokenBalance = tokenIn.balanceOf(address(this));
        if (tokenBalance > 0) {
            TokenSwapData memory tokenSwapData = tokensSwapData[tokenIn];
            uint256 quote = toActualQuote(uint256(tokenSwapData.priceFeed.latestAnswer()), tokenSwapData.priceDivisor);
            uint256 amountOutMin = addSlippage(tokenToWei(tokenBalance, quote, tokenSwapData.reverseQuote), tokenSwapData.slippage);
            if (amountOutMin < minSwapAmount) {
                return 0;
            }
            return UniswapV3Helper.swapToToken(
                address(tokenIn),
                address(weth),
                tokenBalance,
                amountOutMin,
                tokenSwapData.uniswapPoolFee,
                uniswap
            );
        }
        return 0;
    }

    function _withdrawToOwnerIfNeeded() private {
        uint256 hubBalance = relayHub.balanceOf(address(this));
        if (hubBalance >= minWithdrawalAmount + targetHubBalance) {
        relayHub.withdraw(payable(owner()), hubBalance - targetHubBalance);
        }
    }

    function _getTokenFromPaymasterData(bytes calldata paymasterData) internal pure returns (IERC20) {
        return IERC20(address(bytes20(paymasterData[:20])));
    }

    function addPaymasterFee(uint256 charge) public view returns (uint256) {
        return charge * (100 + paymasterFee) / 100;
    }

    function addSlippage(uint256 amount, uint8 slippage) public pure returns (uint256) {
        return amount * (1000 - slippage) / 1000;
    }

    // as this Paymaster already has a permission from a user to operate the tokens on behalf of the gasless account,
    // it makes this same Paymaster a great recipient of a transaction if its only action is a pure token transfer
    function transferToken(IERC20 token, address target, uint256 value) external {
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
        return "3.0.0-beta.3+opengsn.permit-erc20-uniswap-v3.ipaymaster";
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
