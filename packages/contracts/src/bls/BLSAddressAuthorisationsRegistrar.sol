// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "../BaseRelayRecipient.sol";
import "../utils/GsnEip712Library.sol";

import "./BLSTypes.sol";

/*
 * This contract maintains a verified one-to-many mapping of
 * BLS public keys for Ethereum addresses that authorise these keys
 * to act on their behalf using the BLSBatchGateway.
 * Note: BLS key can be authorised by someone who doesn't hold said key,
 * but it does not give such person any advantage so that is not an issue.
 */
contract BLSAddressAuthorisationsRegistrar is BaseRelayRecipient {
    using ECDSA for bytes32;

    event AuthorisationIssued(address indexed authoriser, bytes32 blsPublicKeyHash);

    string public override versionRecipient = "2.2.3+opengsn.bls.address_authorisations_registrar";
    string public prefix = 'sign me up';

    /** 712 start */
    bytes public constant APPROVAL_DATA_TYPE = "ApprovalData(uint256 blsPublicKey0,uint256 blsPublicKey1,uint256 blsPublicKey2,uint256 blsPublicKey3,string clientMessage)";
    bytes32 public constant APPROVAL_DATA_TYPEHASH = keccak256(APPROVAL_DATA_TYPE);

    struct ApprovalData {
        uint256 blsPublicKey0;
        uint256 blsPublicKey1;
        uint256 blsPublicKey2;
        uint256 blsPublicKey3;
        string clientMessage;
    }

    function verifySig(
        ApprovalData memory approvalData,
        address signer,
        bytes memory sig)
    internal
    view
    {
        bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01", GsnEip712Library.domainSeparator(address(this)),
                keccak256(getEncoded(approvalData))
            ));
        require(digest.recover(sig) == signer, "registrar: signature mismatch");
    }

    function getEncoded(
        ApprovalData memory req
    )
    public
    pure
    returns (
        bytes memory
    ) {
        return abi.encode(
            APPROVAL_DATA_TYPEHASH,
            req.blsPublicKey0,
            req.blsPublicKey1,
            req.blsPublicKey2,
            req.blsPublicKey3,
            keccak256(bytes(req.clientMessage))
        );
    }

    /** 712 end */

    mapping(address => uint256[4]) private authorisations;

    function getAuthorisedPublicKey(address authoriser) external view returns (uint256[4] memory){
        return authorisations[authoriser];
    }

    function registerAddressAuthorisation(
        address authoriser,
        uint256[4] memory blsPublicKey,
        bytes memory ecSignature
    ) external {
        verifySig(ApprovalData(blsPublicKey[0], blsPublicKey[1], blsPublicKey[2], blsPublicKey[3], 'I UNDERSTAND WHAT I AM DOING'), authoriser, ecSignature);
        // TODO: extract null-check logic for Key struct?
        require(authorisations[authoriser][0] == 0, 'authoriser already has bls key');
        require(authorisations[authoriser][1] == 0, 'authoriser already has bls key');
        require(authorisations[authoriser][2] == 0, 'authoriser already has bls key');
        require(authorisations[authoriser][3] == 0, 'authoriser already has bls key');

        authorisations[authoriser] = blsPublicKey;

        emit AuthorisationIssued(authoriser, keccak256(abi.encode(blsPublicKey)));
    }
}
