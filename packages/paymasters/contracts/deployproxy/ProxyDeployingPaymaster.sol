//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";

import "../TokenPaymaster.sol";
import "./ProxyFactory.sol";

contract ProxyDeployingPaymaster is TokenPaymaster {
    using Address for address;

    string public override versionPaymaster = "3.0.0-beta.0+opengsn.proxydeploying.ipaymaster";

    ProxyFactory public proxyFactory;

    constructor(IUniswap[] memory _uniswaps, ProxyFactory _proxyFactory) TokenPaymaster(_uniswaps)  {
        proxyFactory = _proxyFactory;
    }

    function getPayer(GsnTypes.RelayRequest calldata relayRequest) public override virtual view returns (address) {
        // TODO: if (rr.paymasterData != '') return address(rr.paymasterData)
        //  this is to support pre-existing proxies/proxies with changed owner
        return proxyFactory.calculateAddress(relayRequest.request.from);
    }


    /**
     * @notice unlike the default implementation we need to allow destination address to have no code deployed yet
     */
    function _verifyForwarder(GsnTypes.RelayRequest calldata relayRequest)
    internal
    virtual
    override
    view
    {
        require(getTrustedForwarder() == relayRequest.relayData.forwarder, "Forwarder is not trusted");
        if (relayRequest.request.to.isContract()){
            GsnEip712Library.verifyForwarderTrusted(relayRequest);
        }
    }

    function _verifyPaymasterData(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {
        // solhint-disable-next-line reason-string
        require(relayRequest.relayData.paymasterData.length == 32, "paymasterData: invalid length for Uniswap v1 exchange address");
    }

    // solhint-disable-next-line no-empty-blocks
    function _verifyValue(GsnTypes.RelayRequest calldata relayRequest) internal virtual override view {}

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal
    override
    virtual
    returns (bytes memory, bool revertOnRecipientRevert) {
        (signature, approvalData);

        (IERC20 token, IUniswap uniswap) = _getToken(relayRequest.relayData.paymasterData);
        (address payer, uint256 tokenPrecharge) = _calculatePreCharge(token, uniswap, relayRequest, maxPossibleGas);
        if (!payer.isContract()) {
            deployProxy(relayRequest.request.from);
        }
        token.transferFrom(payer, address(this), tokenPrecharge);
        //solhint-disable-next-line
        uniswap.tokenToEthSwapOutput(relayRequest.request.value, type(uint256).max, block.timestamp + 60 * 15);
        payable(relayRequest.relayData.forwarder).transfer(relayRequest.request.value);
        return (abi.encode(payer, relayRequest.request.from, tokenPrecharge, relayRequest.request.value, relayRequest.relayData.forwarder, token, uniswap), false);
    }

    function deployProxy(address owner) public returns (ProxyIdentity) {
        ProxyIdentity proxy = proxyFactory.deployProxy(owner);
        proxy.initialize(address(getTrustedForwarder()), tokens);
        return proxy;
    }

    function _postRelayedCall(
        bytes calldata context,
        bool,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal
    override
    virtual {
        (address payer,, uint256 tokenPrecharge, uint256 valueRequested,,IERC20 token, IUniswap uniswap) = abi.decode(context, (address, address, uint256, uint256, address, IERC20, IUniswap));
        _postRelayedCallInternal(payer, tokenPrecharge, valueRequested, gasUseWithoutPost, relayData, token, uniswap);
    }

    // TODO: calculate precise values for these params
    uint256 constant private PRE_RELAYED_CALL_GAS_LIMIT_OVERRIDE = 2000000;
    uint256 constant public PAYMASTER_ACCEPTANCE_BUDGET_OVERRIDE = PRE_RELAYED_CALL_GAS_LIMIT_OVERRIDE + FORWARDER_HUB_OVERHEAD;

    function getGasAndDataLimits()
    public
    override
    pure
    returns (
        GasAndDataLimits memory limits
    ) {
        return GasAndDataLimits(
            PAYMASTER_ACCEPTANCE_BUDGET_OVERRIDE,
            PRE_RELAYED_CALL_GAS_LIMIT_OVERRIDE,
            POST_RELAYED_CALL_GAS_LIMIT,
            CALLDATA_SIZE_LIMIT
        );
    }
}
