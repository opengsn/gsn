// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import "./utils/RLPReader.sol";
import "./utils/GsnUtils.sol";
import "./interfaces/IRelayHub.sol";
import "./interfaces/IPenalizer.sol";

/**
 * @title The Penalizer Implementation
 *
 * @notice This Penalizer supports parsing Legacy, Type 1 and Type 2 raw RLP Encoded transactions.
 */
contract Penalizer is IPenalizer, ERC165 {
    using ECDSA for bytes32;

    /// @inheritdoc IPenalizer
    string public override versionPenalizer = "3.0.0-beta.3+opengsn.penalizer.ipenalizer";

    uint256 internal immutable penalizeBlockDelay;
    uint256 internal immutable penalizeBlockExpiration;

    constructor(
        uint256 _penalizeBlockDelay,
        uint256 _penalizeBlockExpiration
    ) {
        penalizeBlockDelay = _penalizeBlockDelay;
        penalizeBlockExpiration = _penalizeBlockExpiration;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IPenalizer).interfaceId ||
        super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IPenalizer
    function getPenalizeBlockDelay() external override view returns (uint256) {
        return penalizeBlockDelay;
    }

    /// @inheritdoc IPenalizer
    function getPenalizeBlockExpiration() external override view returns (uint256) {
        return penalizeBlockExpiration;
    }

    function isLegacyTransaction(bytes calldata rawTransaction) internal pure returns (bool) {
        uint8 transactionTypeByte = uint8(rawTransaction[0]);
        return (transactionTypeByte >= 0xc0 && transactionTypeByte <= 0xfe);
    }

    function isTransactionType1(bytes calldata rawTransaction) internal pure returns (bool) {
        return (uint8(rawTransaction[0]) == 1);
    }

    function isTransactionType2(bytes calldata rawTransaction) internal pure returns (bool) {
        return (uint8(rawTransaction[0]) == 2);
    }

    /// @return `true` if raw transaction is of types Legacy, 1 or 2. `false` otherwise.
    function isTransactionTypeValid(bytes calldata rawTransaction) public pure returns(bool) {
        return isLegacyTransaction(rawTransaction) || isTransactionType1(rawTransaction) || isTransactionType2(rawTransaction);
    }

    /// @return transaction The details that the `Penalizer` needs to decide if the transaction is penalizable.
    function decodeTransaction(bytes calldata rawTransaction) public pure returns (Transaction memory transaction) {
        if (isTransactionType1(rawTransaction)) {
            (transaction.nonce,
            transaction.gasLimit,
            transaction.to,
            transaction.value,
            transaction.data) = RLPReader.decodeTransactionType1(rawTransaction);
        } else if (isTransactionType2(rawTransaction)) {
            (transaction.nonce,
            transaction.gasLimit,
            transaction.to,
            transaction.value,
            transaction.data) = RLPReader.decodeTransactionType2(rawTransaction);
        } else {
            (transaction.nonce,
            transaction.gasLimit,
            transaction.to,
            transaction.value,
            transaction.data) = RLPReader.decodeLegacyTransaction(rawTransaction);
        }
        return transaction;
    }

    mapping(bytes32 => uint256) public commits;

    /// @inheritdoc IPenalizer
    function commit(bytes32 commitHash) external override {
        uint256 readyBlockNumber = block.number + penalizeBlockDelay;
        commits[commitHash] = readyBlockNumber;
        emit CommitAdded(msg.sender, commitHash, readyBlockNumber);
    }

    /// Modifier that verifies there was a `commit` operation before this call that has not expired yet.
    modifier commitRevealOnly() {
        bytes32 commitHash = keccak256(abi.encodePacked(keccak256(msg.data), msg.sender));
        uint256 readyBlockNumber = commits[commitHash];
        delete commits[commitHash];
        // msg.sender can only be fake during off-chain view call, allowing Penalizer process to check transactions
        if(msg.sender != address(type(uint160).max)) {
            require(readyBlockNumber != 0, "no commit");
            require(readyBlockNumber < block.number, "reveal penalize too soon");
            require(readyBlockNumber + penalizeBlockExpiration > block.number, "reveal penalize too late");
        }
        _;
    }

    /// @inheritdoc IPenalizer
    function penalizeRepeatedNonce(
        bytes calldata unsignedTx1,
        bytes calldata signature1,
        bytes calldata unsignedTx2,
        bytes calldata signature2,
        IRelayHub hub,
        uint256 randomValue
    )
    public
    override
    commitRevealOnly {
        (randomValue);
        _penalizeRepeatedNonce(unsignedTx1, signature1, unsignedTx2, signature2, hub);
    }

    function _penalizeRepeatedNonce(
        bytes calldata unsignedTx1,
        bytes calldata signature1,
        bytes calldata unsignedTx2,
        bytes calldata signature2,
        IRelayHub hub
    )
    private
    {
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

    /// @inheritdoc IPenalizer
    function penalizeIllegalTransaction(
        bytes calldata unsignedTx,
        bytes calldata signature,
        IRelayHub hub,
        uint256 randomValue
    )
    public
    override
    commitRevealOnly {
        (randomValue);
        _penalizeIllegalTransaction(unsignedTx, signature, hub);
    }

    function _penalizeIllegalTransaction(
        bytes calldata unsignedTx,
        bytes calldata signature,
        IRelayHub hub
    )
    private
    {
        if (isTransactionTypeValid(unsignedTx)) {
            Transaction memory decodedTx = decodeTransaction(unsignedTx);
            if (decodedTx.to == address(hub)) {
                bytes4 selector = GsnUtils.getMethodSig(decodedTx.data);
                bool isWrongMethodCall = selector != IRelayHub.relayCall.selector;
                require(
                    isWrongMethodCall,
                    "Legal relay transaction");
            }
        }
        address relay = keccak256(unsignedTx).recover(signature);
        require(relay != address(0), "ecrecover failed");
        penalize(relay, hub);
    }

    function penalize(address relayWorker, IRelayHub hub) private {
        hub.penalize(relayWorker, payable(msg.sender));
    }
}
