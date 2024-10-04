import BN from 'bn.js'

import paymasterAbi from '@opengsn/contracts/artifacts/src/interfaces/IPaymaster.sol/IPaymaster.json'
import relayHubAbi from '@opengsn/contracts/artifacts/src/interfaces/IRelayHub.sol/IRelayHub.json'
import forwarderAbi from '@opengsn/contracts/artifacts/src/forwarder/IForwarder.sol/IForwarder.json'
import stakeManagerAbi from '@opengsn/contracts/artifacts/src/interfaces/IRelayStakeManager.sol/IRelayStakeManager.json'
import penalizerAbi from '@opengsn/contracts/artifacts/src/interfaces/IPenalizer.sol/IPenalizer.json'
import relayRegistrarAbi from '@opengsn/contracts/artifacts/src/interfaces/IRelayRegistrar.sol/IRelayRegistrar.json'
import { getERC165InterfaceID } from './Utils'
import { toBN } from './web3js/Web3JSUtils'

const dayInSec = 24 * 60 * 60
const weekInSec = dayInSec * 7
const yearInSec = dayInSec * 365
const oneEther = toBN(1e18)

export const constants = {
  dayInSec,
  weekInSec,
  yearInSec,
  oneEther,
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  // OpenZeppelin's ERC-20 implementation bans transfer to zero address
  BURN_ADDRESS: '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF',
  // in order to avoid error on insufficient balance for gas, send dry-run call from zero address
  DRY_RUN_ADDRESS: '0x0000000000000000000000000000000000000000',
  DRY_RUN_KEY: 'DRY-RUN',
  ZERO_BYTES32: '0x0000000000000000000000000000000000000000000000000000000000000000',
  MAX_UINT256: new BN('2').pow(new BN('256')).sub(new BN('1')),
  MAX_UINT96: new BN('2').pow(new BN('96')).sub(new BN('1')),
  MAX_INT256: new BN('2').pow(new BN('255')).sub(new BN('1')),
  MIN_INT256: new BN('2').pow(new BN('255')).mul(new BN('-1')),

  ARBITRUM_ARBSYS: '0x0000000000000000000000000000000000000064'
}

export const erc165Interfaces = {
  forwarder: getERC165InterfaceID(forwarderAbi.abi),
  paymaster: getERC165InterfaceID(paymasterAbi.abi),
  penalizer: getERC165InterfaceID(penalizerAbi.abi),
  relayRegistrar: getERC165InterfaceID(relayRegistrarAbi.abi),
  relayHub: getERC165InterfaceID(relayHubAbi.abi),
  stakeManager: getERC165InterfaceID(stakeManagerAbi.abi)
}

export const RelayCallStatusCodes = {
  OK: new BN('0'),
  RelayedCallFailed: new BN('1'),
  RejectedByPreRelayed: new BN('2'),
  RejectedByForwarder: new BN('3'),
  RejectedByRecipientRevert: new BN('4'),
  PostRelayedFailed: new BN('5'),
  PaymasterBalanceChanged: new BN('6')
}
