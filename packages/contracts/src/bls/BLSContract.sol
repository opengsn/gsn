import "./utils/BLS.sol";

contract BLSContract {
    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        uint256[2] memory message
    ) external view returns (bool) {
        return BLS.verifySingle(signature, pubkey, message);
    }


    function verifyMultiple(
        uint256[2] memory signature,
        uint256[4][] memory pubkeys,
        uint256[2][] memory messages
    ) external view returns (bool) {
        return BLS.verifyMultiple(signature, pubkeys, messages);
    }
}
