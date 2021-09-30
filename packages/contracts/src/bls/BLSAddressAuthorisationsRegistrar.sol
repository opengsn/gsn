// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "../BaseRelayRecipient.sol";

import "./BLSTypes.sol";

/*
 * This contract maintains a verified one-to-one mapping between
 * BLS public keys and Ethereum addresses that authorise these keys
 * to act on their behalf using the BLSBatchGateway.
 */
contract BLSAddressAuthorisationsRegistrar is BaseRelayRecipient {
    using ECDSA for bytes32;

    string public override versionRecipient = "2.2.3+opengsn.bls.address_authorisations_registrar";
    string public prefix = 'sign me up';

    mapping(address => BLSTypes.BLSPublicKey) private authorisations;
    mapping(bytes32 => address) private authorisers;

    function getAuthorisation(address authoriser) external view returns (BLSTypes.BLSPublicKey memory){
        return authorisations[authoriser];
    }

    function getAuthoriser(bytes32 blsPublicKeyHash) external view returns (address){
        return authorisers[blsPublicKeyHash];
    }

    function registerAddressAuthorisation(BLSTypes.BLSPublicKey calldata blsPublicKey, bytes calldata ecSignature) external {
        bytes memory ecrecoverMessage = abi.encode(prefix, blsPublicKey);
        address authoriser = keccak256(message).recover(ecSignature);
        bytes memory blsVerifyMessage = abi.encode(prefix, authoriser);
        require(BLS.verifySingle(blsVerifyMessage), "BLS signature verification failed");
        // TODO: extract null-check logic for Key struct?
        require(authorisations[authoriser].pubkey[0] == 0, 'authoriser already has bls key');
        require(authorisations[authoriser].pubkey[1] == 0, 'authoriser already has bls key');
        require(authorisations[authoriser].pubkey[2] == 0, 'authoriser already has bls key');
        require(authorisations[authoriser].pubkey[3] == 0, 'authoriser already has bls key');
        authorisations[authoriser] = blsPublicKey;
        // NOTE: indexed by a message hash, is this ok?
        authorisers[keccak256(message)] = authoriser;
    }
}
