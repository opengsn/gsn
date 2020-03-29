pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./utils/GSNTypes.sol";
import "./utils/EIP712Sig.sol";
import "./interfaces/ITrustedForwarder.sol";

contract TrustedForwarder is ITrustedForwarder {

    EIP712Sig private eip712sig;

    // Nonces of senders, used to prevent replay attacks
    mapping(address => uint256) private nonces;

    constructor() public {
        eip712sig = new EIP712Sig(address(this));
    }

    function getNonce(address from) external view returns (uint256) {
        return nonces[from];
    }

    function verify(GSNTypes.RelayRequest memory req, bytes memory sig) public view {
        _verify(req, sig);
    }

    function verifyAndCall(GSNTypes.RelayRequest memory req, bytes memory sig) public returns (bool success, bytes memory ret) {
        _verify(req, sig);
        _updateNonce(req);

        return req.target.call.gas(req.gasData.gasLimit)
        (abi.encodePacked(req.encodedFunction, req.relayData.senderAddress));
    }

    function _verify(GSNTypes.RelayRequest memory req, bytes memory sig) internal view {
        _verifyNonce(req);
        _verifySig(req, sig);
    }

    function _verifyNonce(GSNTypes.RelayRequest memory req) internal view {
        require(nonces[req.relayData.senderAddress] == req.relayData.senderNonce, "nonce mismatch");
    }

    function _updateNonce(GSNTypes.RelayRequest memory req) internal {
        nonces[req.relayData.senderAddress]++;
    }

    function _verifySig(GSNTypes.RelayRequest memory req, bytes memory sig) internal view {
        require(eip712sig.verify(req, sig), "signature mismatch");
    }
}
