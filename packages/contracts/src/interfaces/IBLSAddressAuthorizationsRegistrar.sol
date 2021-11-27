// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

/*
 * This contract maintains a verified one-to-many mapping of
 * BLS public keys for Ethereum addresses that authorize these keys
 * to act on their behalf using the BLSBatchGateway.
 * Note: BLS key can be authorized by someone who doesn't hold said key,
 * but it does not give such person any advantage so that is not an issue.
 */
interface IBLSAddressAuthorizationsRegistrar {
    event AuthorizationIssued(address indexed authorizer, bytes32 blsPublicKeyHash);
    struct ApprovalData {
        uint256 blsPublicKey0;
        uint256 blsPublicKey1;
        uint256 blsPublicKey2;
        uint256 blsPublicKey3;
        string clientMessage;
    }

    /** 712 start */

    function getEncoded(
        ApprovalData memory req
    )
    external
    pure
    returns (
        bytes memory
    );

    /** 712 end */

    function getAuthorizedPublicKey(address authorizer) external view returns (uint256[4] memory);

    function registerAddressAuthorization(
        address authorizer,
        bytes memory ecdsaSignature,
        uint256[4] memory blsPublicKey,
        uint256[2] memory blsSignature
    ) external;
}
