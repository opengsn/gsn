// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@opengsn/contracts/src/forwarder/IForwarder.sol";
import "@opengsn/contracts/src/BasePaymaster.sol";

import "./interfaces/IUniswapV3.sol";

/**
 * A Token-based paymaster.
 * - each request is paid for by the caller.
 * - acceptRelayedCall - verify the caller can pay for the request in tokens.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract TokenPaymaster is BasePaymaster {

    function versionPaymaster() external override virtual view returns (string memory){
        return "3.0.0-beta.3+opengsn.token.ipaymaster";
    }


    IUniswapV3[] public uniswaps;
    IERC20[] public tokens;

    mapping (IUniswapV3=>bool ) private supportedUniswaps;

    uint256 public gasUsedByPost;

    constructor(IUniswapV3[] memory _uniswaps) {
        uniswaps = _uniswaps;

        for (uint256 i = 0; i < _uniswaps.length; i++){
            supportedUniswaps[_uniswaps[i]] = true;
            tokens.push(IERC20(_uniswaps[i].tokenAddress()));
            tokens[i].approve(address(_uniswaps[i]), type(uint256).max);
        }
    }

    /**
     * set gas used by postRelayedCall, for proper gas calculation.
     * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall,
     * but also the gas usage of the token and of Uniswap)
     */
    function setPostGasUsage(uint256 _gasUsedByPost) external onlyOwner {
        gasUsedByPost = _gasUsedByPost;
    }

    // return the payer of this request.
    // for account-based target, this is the target account.
    function getPayer(GsnTypes.RelayRequest calldata relayRequest) public virtual view returns (address) {
        (this);
        return relayRequest.request.to;
    }

    event Received(uint256 eth);
    receive() external override payable {
        emit Received(msg.value);
    }

    function _getToken(bytes memory paymasterData) internal view returns (IERC20 token, IUniswapV3 uniswap) {
        uniswap = abi.decode(paymasterData, (IUniswapV3));
        require(supportedUniswaps[uniswap], "unsupported token uniswap");
        token = IERC20(uniswap.tokenAddress());
    }

    function _calculatePreCharge(
        IERC20 token,
        IUniswapV3 uniswap,
        GsnTypes.RelayRequest calldata relayRequest,
        uint256 maxPossibleGas)
    internal
    view
    returns (address payer, uint256 tokenPreCharge) {
        (token);
        payer = this.getPayer(relayRequest);
        uint256 ethMaxCharge = relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData);
        ethMaxCharge += relayRequest.request.value;
        tokenPreCharge = uniswap.getTokenToEthOutputPrice(ethMaxCharge);
    }

    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {
        // solhint-disable-next-line reason-string
        require(relayRequest.relayData.paymasterData.length == 32, "paymasterData: invalid length for Uniswap v3 exchange address");
    }

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    virtual
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (signature, approvalData);

        (IERC20 token, IUniswapV3 uniswap) = _getToken(relayRequest.relayData.paymasterData);
        (address payer, uint256 tokenPrecharge) = _calculatePreCharge(token, uniswap, relayRequest, maxPossibleGas);
        token.transferFrom(payer, address(this), tokenPrecharge);
        return (abi.encode(payer, tokenPrecharge, token, uniswap), false);
    }

    function _postRelayedCall(
        bytes calldata context,
        bool,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal
    override
    virtual
    {
        (address payer, uint256 tokenPrecharge, IERC20 token, IUniswapV3 uniswap) = abi.decode(context, (address, uint256, IERC20, IUniswapV3));
        _postRelayedCallInternal(payer, tokenPrecharge, 0, gasUseWithoutPost, relayData, token, uniswap);
    }

    function _postRelayedCallInternal(
        address payer,
        uint256 tokenPrecharge,
        uint256 valueRequested,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData,
        IERC20 token,
        IUniswapV3 uniswap
    ) internal {
        uint256 ethActualCharge = relayHub.calculateCharge(gasUseWithoutPost + gasUsedByPost, relayData);
        uint256 tokenActualCharge = uniswap.getTokenToEthOutputPrice(valueRequested + ethActualCharge);
        uint256 tokenRefund = tokenPrecharge - tokenActualCharge;
        _refundPayer(payer, token, tokenRefund);
        _depositProceedsToHub(ethActualCharge, uniswap);
        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, ethActualCharge, tokenActualCharge);
    }

    function _refundPayer(
        address payer,
        IERC20 token,
        uint256 tokenRefund
    ) private {
        require(token.transfer(payer, tokenRefund), "failed refund");
    }

    function _depositProceedsToHub(uint256 ethActualCharge, IUniswapV3 uniswap) private {
        //solhint-disable-next-line
        uniswap.tokenToEthSwapOutput(ethActualCharge, type(uint256).max, block.timestamp+60*15);
        relayHub.depositFor{value:ethActualCharge}(address(this));
    }

    event TokensCharged(uint256 gasUseWithoutPost, uint256 gasJustPost, uint256 ethActualCharge, uint256 tokenActualCharge);
}
