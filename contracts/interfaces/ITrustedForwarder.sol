pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "../utils/GSNTypes.sol";

contract ITrustedForwarder {

    // verify the signature matches the request.
    //  that is, the senderAccount is the signer
    function verify(GSNTypes.RelayRequest memory req, bytes memory sig) public view returns (bool);

    function getNonce(address from) external view returns (uint256);

    // validate the signature, and execute the call.
    function verifyAndCall(GSNTypes.RelayRequest memory req, bytes memory sig) public returns (bool success, bytes memory ret);
}
