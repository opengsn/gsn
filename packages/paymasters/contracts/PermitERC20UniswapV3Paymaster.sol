// SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "@opengsn/contracts/src/forwarder/IForwarder.sol";
import "@opengsn/contracts/src/BaseRelayRecipient.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";
import "@opengsn/contracts/src/utils/GsnUtils.sol";

import "./interfaces/IChainlinkOracle.sol";

import "./helpers/UniswapV3Helper.sol";
import "./helpers/PermitInterfaceDAI.sol";

/**
 * A paymaster allowing addresses holding ERC20 tokens with 'permit' functionality
 * to pay for a GSN transaction.
 */
contract PermitERC20UniswapV3Paymaster is BasePaymaster, BaseRelayRecipient {
    using SafeMath for uint256;

    event Received(address indexed sender, uint256 eth);
    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 ethActualCharge);

    IChainlinkOracle public priceFeed;
    ISwapRouter public uniswap;
    IERC20 public token;
    IERC20 public weth;

    uint24 public uniswapPoolFee;
    uint256 public gasUsedByPost;
    bytes4 public permitMethodSignature;
    uint256 public permitMethodDataLength;

    function versionPaymaster() external override virtual view returns (string memory){
        return "2.2.3+opengsn.permit-erc20-uniswap-v3.ipaymaster";
    }

    function versionRecipient() external override virtual view returns (string memory){
        return "2.2.3+opengsn.permit-erc20-uniswap-v3.irelayrecipient";
    }

    function trustedForwarder() override(BasePaymaster, BaseRelayRecipient) public view returns (address forwarder){
        forwarder = BaseRelayRecipient.trustedForwarder();
    }

    function setTrustedForwarder(address _forwarder) public override onlyOwner {
        _setTrustedForwarder(_forwarder);
    }

    function _msgSender() internal view override(Context, BaseRelayRecipient) returns (address sender) {
        sender = BaseRelayRecipient._msgSender();
    }

    function _msgData() internal view override(Context, BaseRelayRecipient) returns (bytes memory) {
        return BaseRelayRecipient._msgData();
    }

    constructor(
        IERC20 _weth,
        IERC20 _token,
        IRelayHub _relayHub,
        ISwapRouter _uniswap,
        IChainlinkOracle _priceFeed,
        address _trustedForwarder,
        uint24 _uniswapPoolFee,
        uint256 _gasUsedByPost,
        uint256 _permitMethodDataLength,
        string memory _permitMethodSignature
    ) {
        weth = _weth;
        token = _token;
        uniswap = _uniswap;
        priceFeed = _priceFeed;
        uniswapPoolFee = _uniswapPoolFee;
        permitMethodSignature = bytes4(keccak256(bytes(_permitMethodSignature)));
        permitMethodDataLength = _permitMethodDataLength;
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
        uint256 maxPossibleGas)
    internal
    view
    returns (uint256 tokenPreCharge) {
        uint256 ethMaxCharge =
            relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData) +
            relayRequest.request.value;
        uint256 price = uint256(priceFeed.latestAnswer());
        uint256 decimals = uint256(priceFeed.decimals());
        tokenPreCharge = ethMaxCharge.mul(price).div(10**decimals);
    }

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    relayHubOnly
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (signature);
        require(approvalData.length == 0, "approvalData: invalid length");
        if (relayRequest.relayData.paymasterData.length != 0) {
            require(relayRequest.relayData.paymasterData.length >= 4, "paymastaData: missing method sig");
            require(
                permitMethodSignature == GsnUtils.getMethodSig(relayRequest.relayData.paymasterData),
                "paymasterData: wrong method sig");
            // execute permit method for this token
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory ret) = address(token).call(relayRequest.relayData.paymasterData);
            require(success, string(abi.encodePacked("permit call reverted:", string(ret))));
        }
        uint256 tokenPreCharge = _calculatePreCharge(relayRequest, maxPossibleGas);
        address payer = relayRequest.request.from;
        require(token.transferFrom(payer, address(this), tokenPreCharge), "failed pre-charge");
        return (abi.encode(payer, tokenPreCharge), false);
    }

    function postRelayedCall(
        bytes calldata context,
        bool,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    relayHubOnly {
        (address payer,) = abi.decode(context, (address, uint256));
        uint256 ethActualCharge = relayHub.calculateCharge(gasUseWithoutPost.add(gasUsedByPost), relayData);
        _depositProceedsToHub(ethActualCharge);
        uint256 remainingTokenBalance = token.balanceOf(address(this));
        require(token.transfer(payer, remainingTokenBalance), "failed refund");
        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, ethActualCharge);
    }

    function _depositProceedsToHub(uint256 ethActualCharge) private {
        UniswapV3Helper.swapToEth(
            address(weth),
            address(token),
            ethActualCharge,
            uniswapPoolFee,
            uniswap
        );
        relayHub.depositFor{value : address(this).balance}(address(this));
    }

    // as this Paymaster already has a permission from a user to operate the tokens on behalf of the gasless account,
    // it makes this same Paymaster a great recipient of a transaction if its only action is a pure token transfer
    function transferToken(address target, uint256 value) external {
        require(msg.sender == trustedForwarder(), "must be a meta-tx");
        require(token.transferFrom(_msgSender(), target, value), "transferToken failed");
    }

    receive() external override payable {
        emit Received(msg.sender, msg.value);
    }
}
