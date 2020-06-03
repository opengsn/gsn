// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "./utils/GsnUtils.sol";
import "./interfaces/IForwarder.sol";
import "./SignatureVerifier.sol";

contract Forwarder is IForwarder {

    function versionForwarder() external view virtual override returns (string memory){
        return "2.0.0-alpha.1+opengsn.forwarder.iforwarder";
    }

    SignatureVerifier private signatureVerifier;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    constructor() public {
        signatureVerifier = new SignatureVerifier(address(this));
    }

    function getNonce(address from) external override view returns (uint256) {
        return nonces[from];
    }

    function verify(ISignatureVerifier.RelayRequest memory req, bytes memory sig) public override view {
        _verify(req, sig);
    }

    function verifyAndCall(ISignatureVerifier.RelayRequest memory req, bytes memory sig)
    public
    override
    {
        _verify(req, sig);
        _updateNonce(req);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returnValue) = req.target.call{gas:req.gasData.gasLimit}(abi.encodePacked(req.encodedFunction, req.relayData.senderAddress));
        // TODO: use assembly to prevent double-wrapping of the revert reason (part of GSN-37)
        require(success, GsnUtils.getError(returnValue));
    }

    function _verify(ISignatureVerifier.RelayRequest memory req, bytes memory sig) internal view {
        _verifyNonce(req);
        _verifySig(req, sig);
    }

    function _verifyNonce(ISignatureVerifier.RelayRequest memory req) internal view {
        require(nonces[req.relayData.senderAddress] == req.relayData.senderNonce, "nonce mismatch");
    }

    function _updateNonce(ISignatureVerifier.RelayRequest memory req) internal {
        nonces[req.relayData.senderAddress]++;
    }

    function _verifySig(ISignatureVerifier.RelayRequest memory req, bytes memory sig) internal view {
        require(signatureVerifier.verify(req, sig), "signature mismatch");
    }
}
