// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@opengsn/contracts/src/utils/GsnTypes.sol";
import "@opengsn/contracts/src/interfaces/IPaymaster.sol";
import "@opengsn/contracts/src/interfaces/IRelayHub.sol";

/**
 * This mock relay hub contract is only used to be called by a Gateway without creating the full GSN deployment
 */
contract BLSTestHub is IRelayHub {
    event ReceivedRelayCall(uint256 batchItemId, address requestFrom, address requestTo);

    function relayCall(
        uint256 batchItemId,
        uint maxAcceptanceBudget,
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData
    )
    external
    override
    returns (bool paymasterAccepted, bytes memory returnValue){
        emit ReceivedRelayCall(batchItemId, relayRequest.request.from, relayRequest.request.to);
        return (true, '');
    }

    function penalize(address relayWorker, address payable beneficiary) external override {revert();}

    function setConfiguration(RelayHubConfig memory _config) external override {revert();}

    function deprecateHub(uint256 fromBlock) external override {revert();}

    function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) external override view returns (uint256) {return 0;}

    function addRelayWorkers(address[] calldata newRelayWorkers) external override {revert();}

    function registerRelayServer(uint256 baseRelayFee, uint256 pctRelayFee, string calldata url) external override {revert();}

    function depositFor(address target) external override payable {revert();}

    function withdraw(uint256 amount, address payable dest) external override {revert();}

    function getConfiguration() external override view returns (RelayHubConfig memory config) {revert();}

    function workerToManager(address worker) external override view returns (address) {revert();}

    function workerCount(address manager) external override view returns (uint256) {revert();}

    function balanceOf(address target) external override view returns (uint256) {revert();}

    function stakeManager() external override view returns (IStakeManager) {revert();}

    function penalizer() external override view returns (address) {revert();}

    function isRelayManagerStaked(address relayManager) external override view returns (bool) {revert();}

    function isDeprecated() external override view returns (bool) {revert();}

    function deprecationBlock() external override view returns (uint256) {revert();}

    function versionHub() external override view returns (string memory) {revert();}
}
