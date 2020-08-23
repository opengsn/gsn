// @ts-ignore
import abiDecoder from 'abi-decoder'

import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx'

import RelayHubABI from '../../common/interfaces/IRelayHub.json'
import PayMasterABI from '../../common/interfaces/IPaymaster.json'
import StakeManagerABI from '../../common/interfaces/IStakeManager.json'

import { KeyManager } from '../KeyManager'
import ContractInteractor from '../../relayclient/ContractInteractor'
import { Address } from '../../relayclient/types/Aliases'
import { address2topic, isSameAddress } from '../../common/Utils'
import { IRelayHubInstance } from '../../../types/truffle-contracts'
import VersionsManager from '../../common/VersionsManager'
import { bufferToHex, bufferToInt, isZeroAddress } from 'ethereumjs-util'
// import { IPaymasterInstance, IRelayHubInstance, IStakeManagerInstance } from '../../../types/truffle-contracts'
// import { BlockHeader } from 'web3-eth'
// import { Log, TransactionReceipt } from 'web3-core'
// import { toBN, toHex } from 'web3-utils'
// import { defaultEnvironment } from '../common/Environments'
// import VersionsManager from '../common/VersionsManager'
// import { calculateTransactionMaxPossibleGas, decodeRevertReason, address2topic, randomInRange, sleep } from '../common/Utils'
// import { constants } from '../common/Constants'

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const VERSION = '2.0.0-beta.1'

export interface PenalizeRequest {
  signedTx: PrefixedHexString
}

export class Penalizer {
  keyManager: KeyManager
  contractInteractor: ContractInteractor
  hubAddress: Address
  hubContract: IRelayHubInstance | undefined
  versionManager: VersionsManager
  devMode: boolean
  initialized: boolean = false

  constructor (keyManager: KeyManager, hubAddress: Address, contractInteractor: ContractInteractor, devMode: boolean) {
    this.keyManager = keyManager
    this.contractInteractor = contractInteractor
    this.hubAddress = hubAddress
    this.versionManager = new VersionsManager(VERSION)
    this.devMode = devMode
  }

  async _init (): Promise<void> {
    await this.contractInteractor._init()
    this.hubContract = await this.contractInteractor._createRelayHub(this.hubAddress)
    const relayHubAddress = this.hubContract.address
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      console.log(`No RelayHub deployed at address ${relayHubAddress}.`)
      process.exit(1)
    }
    const version = await this.hubContract.versionHub().catch((_: any) => 'no getVersion() method')
    if (!this.versionManager.isMinorSameOrNewer(version)) {
      console.log(`Not a valid RelayHub at ${relayHubAddress}: version: ${version}`)
      process.exit(1)
    }
    // const relayHubTopics = [Object.keys(this.hubContract.contract.events).filter(x => (x.includes('0x')))]
    // this.rhTopics = relayHubTopics.concat([[address2topic(this.keyManager.getAddress(0))]])

    if (this.devMode && (this.contractInteractor.getChainId() < 1000 || this.contractInteractor.getNetworkId() < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(1)
    }

    console.log('Penalizer service initialized')
    this.initialized = true
  }

  // Only handles illegal nonce penalization flow
  async tryToPenalize (req: PenalizeRequest): Promise<boolean> {
    if (!this.initialized) {
      return false
    }
    if (this.hubContract == null) {
      return false
    }
    // deserialize the tx
    const tx = new Transaction(req.signedTx, this.contractInteractor.getRawTxOptions())

    // check signature
    if (!tx.verifySignature()) {
      // signature is invalid, cannot penalize
      return false
    }
    // check that it's a registered relay
    const relayWorker = bufferToHex(tx.getSenderAddress())
    const relayManager = await this.hubContract.workerToManager(relayWorker)
    if (isZeroAddress(relayManager)) {
      // unknown worker address to Hub
      return false
    }
    const staked = await this.hubContract.isRelayManagerStaked(relayManager)
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!staked) {
      // relayManager is not staked so not penalizable
      return false
    }

    // read the relay worker's nonce from blockchain
    const currentNonce = await this.contractInteractor.getTransactionCount(relayWorker, 'pending')
    // if tx nonce > current nonce, publish tx and await
    // otherwise, get mined tx with same nonce. if equals (up to different gasPrice) to received tx, return.
    // Otherwise, penalize.
    if (bufferToInt(tx.nonce) <= currentNonce) {
      this.contractInteractor.web3.eth.
    }

    return true
  }
}