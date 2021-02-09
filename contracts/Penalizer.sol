// SPDX-License-Identifier:MIT
pragma solidity >=0.7.5;
pragma abicoder v2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";

import "./utils/RLPReader.sol";
import "./utils/GsnUtils.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPenalizer.sol";

contract Penalizer is IPenalizer{

    string public override versionPenalizer = "2.0.0+opengsn.penalizer.ipenalizer";

    using ECDSA for bytes32;

    function decodeTransaction(bytes memory rawTransaction) private pure returns (Transaction memory transaction) {
        (transaction.nonce,
        transaction.gasPrice,
        transaction.gasLimit,
        transaction.to,
        transaction.value,
        transaction.data) = RLPReader.decodeTransaction(rawTransaction);
        return transaction;

    }

    modifier relayManagerOnly(IRelayHub hub) {
        require(msg.sender==address(0) || hub.isRelayManagerStaked(msg.sender), "Unknown relay manager");
        _;
    }

    function penalizeRepeatedNonce(
        bytes memory unsignedTx1,
        bytes memory signature1,
        bytes memory unsignedTx2,
        bytes memory signature2,
        IRelayHub hub
    )
    public
    override
    relayManagerOnly(hub)
    {
        // Can be called by a relay manager only.
        // If a relay attacked the system by signing multiple transactions with the same nonce
        // (so only one is accepted), anyone can grab both transactions from the blockchain and submit them here.
        // Check whether unsignedTx1 != unsignedTx2, that both are signed by the same address,
        // and that unsignedTx1.nonce == unsignedTx2.nonce.
        // If all conditions are met, relay is considered an "offending relay".
        // The offending relay will be unregistered immediately, its stake will be forfeited and given
        // to the address who reported it (msg.sender), thus incentivizing anyone to report offending relays.
        // If reported via a relay, the forfeited stake is split between
        // msg.sender (the relay used for reporting) and the address that reported it.

        address addr1 = keccak256(unsignedTx1).recover(signature1);
        address addr2 = keccak256(unsignedTx2).recover(signature2);

        require(addr1 == addr2, "Different signer");
        require(addr1 != address(0), "ecrecover failed");

        Transaction memory decodedTx1 = decodeTransaction(unsignedTx1);
        Transaction memory decodedTx2 = decodeTransaction(unsignedTx2);

        // checking that the same nonce is used in both transaction, with both signed by the same address
        // and the actual data is different
        // note: we compare the hash of the tx to save gas over iterating both byte arrays
        require(decodedTx1.nonce == decodedTx2.nonce, "Different nonce");

        bytes memory dataToCheck1 =
        abi.encodePacked(decodedTx1.data, decodedTx1.gasLimit, decodedTx1.to, decodedTx1.value);

        bytes memory dataToCheck2 =
        abi.encodePacked(decodedTx2.data, decodedTx2.gasLimit, decodedTx2.to, decodedTx2.value);

        require(keccak256(dataToCheck1) != keccak256(dataToCheck2), "tx is equal");

        penalize(addr1, hub);
    }

    function penalizeIllegalTransaction(
        bytes memory unsignedTx,
        bytes memory signature,
        IRelayHub hub
    )
    public
    override
    relayManagerOnly(hub)
    {
        Transaction memory decodedTx = decodeTransaction(unsignedTx);
        if (decodedTx.to == address(hub)) {
            bytes4 selector = GsnUtils.getMethodSig(decodedTx.data);
            bool isRelayCall = selector == IRelayHub.relayCall.selector;
            uint externalGasLimit;
            if ( isRelayCall ) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, bytes memory ret) = address(this).call(decodedTx.data);
                if (!success ) {
                    isRelayCall=false;
                } else {
                    (externalGasLimit) = abi.decode(ret,(uint));
                }
            }
            require(
                !isRelayCall ||
                externalGasLimit != decodedTx.gasLimit,
                "Legal relay transaction");
        }
        address relay = keccak256(unsignedTx).recover(signature);
        require(relay != address(0), "ecrecover failed");

        penalize(relay, hub);
    }

    // Helper method for verification.
    // can (and should) be called with encoded IRelayHub.relayCall()
    // before submitting it on chain.
    // reverts if the message is not structured properly, and is penalizeable
    // NOTE: return value differs from real method is used by penalizer
    function relayCall(
        uint paymasterMaxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint externalGasLimit
    ) external pure returns (uint retExternalGasLimit) {
        (paymasterMaxAcceptanceBudget);
        // abicoder v2: https://docs.soliditylang.org/en/latest/abi-spec.html
        // static params are 1 word
        // struct (with dynamic members) has offset to struct
        // dynamic member has offset,length and ceil(length/32) for data
        // 5 method params,
        // relayRequest: 2 members
        // relayData 8 members
        // ForwardRequest: 7 members
        // total 22 words if all dynamic params are zero-length.

        uint expectedMsgDataLen = 4 + 22*32 +
            len1(signature) + len1(approvalData) + len1(relayRequest.request.data) + len1(relayRequest.relayData.paymasterData);
        require(signature.length <= 65, "invalid signature length");
        int extraMsgData = int(expectedMsgDataLen - msg.data.length);
        require(extraMsgData == 0, "extra msg.data");

        return (externalGasLimit);
    }
    function len1(bytes calldata buf) public pure returns (uint) {
        return (1+(buf.length+31)/32)*32;
    }

    function penalize(address relayWorker, IRelayHub hub) private {
        hub.penalize(relayWorker, msg.sender);
    }
}
