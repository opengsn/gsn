import BN from 'bn.js'

import paymasterAbi from './interfaces/IPaymaster.json'
import relayHubAbi from './interfaces/IRelayHub.json'
import forwarderAbi from './interfaces/IForwarder.json'
import stakeManagerAbi from './interfaces/IStakeManager.json'
import penalizerAbi from './interfaces/IPenalizer.json'
import relayRegistrarAbi from './interfaces/IRelayRegistrar.json'
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
  forwarder: getERC165InterfaceID(forwarderAbi as any),
  paymaster: getERC165InterfaceID(paymasterAbi as any),
  penalizer: getERC165InterfaceID(penalizerAbi as any),
  relayRegistrar: getERC165InterfaceID(relayRegistrarAbi as any),
  relayHub: getERC165InterfaceID(relayHubAbi as any),
  stakeManager: getERC165InterfaceID(stakeManagerAbi as any)
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
