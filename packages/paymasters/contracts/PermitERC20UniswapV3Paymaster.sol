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
//    IChainlinkOracle[] public immutable priceFeeds;
    mapping(IERC20 => IChainlinkOracle) public priceFeeds;

    // priceDivisor = 10 ** priceFeed.decimals()
//    uint256[] public immutable priceDivisors;
    mapping(IERC20 => uint256) public priceDivisors;

    ISwapRouter public uniswap;
    IERC20[] public tokens;
    IERC20 public immutable weth;
    mapping(IERC20 => bytes4) public permitMethodSignatures;

    uint24 public uniswapPoolFee;
    uint256 public gasUsedByPost;


    // Upon reaching minHubBalance, the paymaster will deposit eth to RelayHub to reach targetHubBalance
    uint256 public minHubBalance;
    uint256 public targetHubBalance;
    // Minimum eth amount, above targetHubBalance, to send to the owner
    uint256 public minWithdrawalAmount;
    uint256 public paymasterFee;

    struct PaymasterConfig {
        IERC20 weth;
        IERC20[] tokens;
        IRelayHub relayHub;
        IChainlinkOracle[] priceFeeds;
        ISwapRouter uniswap;
        address trustedForwarder;
        uint24 uniswapPoolFee;
        uint256 gasUsedByPost;
        string[] permitMethodSignatures;
        uint256 minHubBalance;
        uint256 targetHubBalance;
        uint256 minWithdrawalAmount;
        uint256 paymasterFee;
    }

    constructor(
        PaymasterConfig memory config
    ) {
        weth = config.weth;
//        tokens = _tokens;
        setUniswap(config.uniswap, config.uniswapPoolFee);
//        uniswap = _uniswap;
        //        priceFeeds = _priceFeeds;
//        uniswapPoolFee = _uniswapPoolFee;
//        permitMethodSignature = bytes4(keccak256(bytes(_permitMethodSignature)));

        setMinHubBalance(config.minHubBalance);
        setTargetHubBalance(config.targetHubBalance);
        setMinWithdrawalAmount(config.minWithdrawalAmount);
//        priceDivisor = 10 ** uint256(priceFeeds.decimals());

        setPaymasterFee(config.paymasterFee);
        setRelayHub(config.relayHub);
        setPostGasUsage(config.gasUsedByPost);
        setTrustedForwarder(config.trustedForwarder);
        setTokens(config.tokens, config.priceFeeds, config.permitMethodSignatures);
//        // allow uniswap to transfer from paymaster balance
//        for (int i = 0; i < tokens.length; i++) {
//            IERC20 token = tokens[i];
//            token.approve(address(uniswap), type(uint256).max);
//            priceDivisors[token] = 10 ** uint256(_priceFeeds[i].decimals());
//            priceFeeds[token] = _priceFeeds[i];
//        }
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

    function setUniswap(ISwapRouter _uniswap, uint24 _uniswapPoolFee) public onlyOwner {
        uniswap = _uniswap;
        uniswapPoolFee = _uniswapPoolFee;
    }

    function setTokens(IERC20[] memory _tokens, IChainlinkOracle[] memory _priceFeeds, string[] memory _permitMethodSignatures) public onlyOwner {
        tokens = _tokens;
        // allow uniswap to transfer from paymaster balance
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            token.approve(address(uniswap), type(uint256).max);
            priceDivisors[token] = 10 ** uint256(_priceFeeds[i].decimals());
            priceFeeds[token] = _priceFeeds[i];
            permitMethodSignatures[token] = bytes4(keccak256(bytes(_permitMethodSignatures[i])));
        }
    }

    function refillHubDeposit(uint256 amount) public onlyOwner {
        _refillHubDeposit(amount);
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
        tokenCharge = addPaymasterFee(ethCharge * priceQuote / priceDivisor);
    }

    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {}

    function isTokenSupported(IERC20 token) public view returns (bool) {
//        for (int i = 0; i < tokens.length; i++) {
//            if (token == tokens[i]) {
//                return true;
//            }
//        }
//        return false;
        return priceDivisors[token] != 0;
    }

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

        // paymasterData must contain the token address, and optionally a a valid "permit" call on the token.
        require(relayRequest.relayData.paymasterData.length >= 20, "paymasterData: must contain token address");
        IERC20 token = _getTokenFromPaymasterData(relayRequest.relayData.paymasterData);
        require(isTokenSupported(token),"unsupported token");
        if (relayRequest.relayData.paymasterData.length != 20) {
            require(relayRequest.relayData.paymasterData.length >= 24, "paymasterData: must contain \"permit\" method and token address");
            require(
                permitMethodSignatures[token] == GsnUtils.getMethodSig(relayRequest.relayData.paymasterData),
                "paymasterData: wrong \"permit\" method sig");
            // execute permit method for this token
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory ret) = address(token).call(relayRequest.relayData.paymasterData[:relayRequest.relayData.paymasterData.length - 20]);
            require(success, string(abi.encodePacked("permit call reverted:", string(ret))));
        }

        uint256 priceQuote = uint256(priceFeeds[token].latestAnswer());

        (uint256 tokenPreCharge,) = _calculateCharge(relayRequest.relayData, maxPossibleGas, priceQuote, priceDivisors[token]);
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
        IERC20 token = _getTokenFromPaymasterData(relayData.paymasterData);
//        uint256 ethActualCharge = relayHub.calculateCharge(gasUseWithoutPost + gasUsedByPost, relayData);
//        uint256 tokenActualCharge = addPaymasterFee(ethActualCharge * priceQuote / priceDivisors[token]);
        (uint256 tokenActualCharge, uint256 ethActualCharge) = _calculateCharge(relayData, gasUseWithoutPost + gasUsedByPost, priceQuote, priceDivisors[token]);
        require(tokenActualCharge <= tokenPreCharge, "actual charge higher");
        token.safeTransfer(payer, tokenPreCharge - tokenActualCharge);

        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, tokenActualCharge, ethActualCharge);
        _refillHubDepositIfNeeded(ethActualCharge);
        _withdrawToOwnerIfNeeded();
    }

    function _refillHubDepositIfNeeded(uint256 ethActualCharge) private {
        uint256 hubBalance = relayHub.balanceOf(address(this));
        if (hubBalance - ethActualCharge >= minHubBalance) {
            return;
        }
        uint256 minDepositAmount = targetHubBalance - hubBalance + ethActualCharge;
        _refillHubDeposit(minDepositAmount);
    }

    function _refillHubDeposit(uint256 minDepositAmount) private {
        IERC20 mainToken = tokens[0];
        for (uint256 i = 1; i < tokens.length; i++) {
            IERC20 tokenIn = tokens[i];
            uint256 tokenBalance = tokenIn.balanceOf(address(this));
            if (tokenBalance > 0) {
                UniswapV3Helper.swapToToken(
                    address(tokenIn),
                    address(mainToken),
                    tokenBalance,
                    uniswapPoolFee,
                    uniswap
                );
            }
        }
        UniswapV3Helper.swapToEth(
            address(mainToken),
            address(weth),
            minDepositAmount,
            uniswapPoolFee,
            uniswap
        );
        relayHub.depositFor{value : address(this).balance}(address(this));
    }

    function _withdrawToOwnerIfNeeded() private {
        uint256 hubBalance = relayHub.balanceOf(address(this));
        if (hubBalance >= minWithdrawalAmount + targetHubBalance) {
        relayHub.withdraw(payable(owner()), hubBalance - targetHubBalance);
        }
    }

    function _getTokenFromPaymasterData(bytes calldata paymasterData) internal pure returns (IERC20) {
        return IERC20(address(bytes20(paymasterData[paymasterData.length - 20:])));
    }

    function addPaymasterFee(uint256 charge) public view returns (uint256) {
        return charge * (100 + paymasterFee) / 100;
    }

    // as this Paymaster already has a permission from a user to operate the tokens on behalf of the gasless account,
    // it makes this same Paymaster a great recipient of a transaction if its only action is a pure token transfer
    function transferToken(IERC20 token, address target, uint256 value) external {
        require(msg.sender == getTrustedForwarder(), "must be a meta-tx");
        token.safeTransferFrom(_msgSender(), target, value);
    }

//    receive() external override payable {
//        emit Received(msg.sender, msg.value);
//    }

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
