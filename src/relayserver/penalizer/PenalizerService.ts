// @ts-ignore
import abiDecoder from 'abi-decoder'
import log from 'loglevel'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'

import RelayHubABI from '../../common/interfaces/IRelayHub.json'
import PayMasterABI from '../../common/interfaces/IPaymaster.json'
import StakeManagerABI from '../../common/interfaces/IStakeManager.json'

import ContractInteractor from '../../relayclient/ContractInteractor'
import VersionsManager from '../../common/VersionsManager'
import { bufferToHex, bufferToInt, isZeroAddress } from 'ethereumjs-util'
import { TxByNonceService } from './TxByNonceService'
import { getDataAndSignature } from '../../common/Utils'
import replaceErrors from '../../common/ErrorReplacerJSON'
import { TransactionManager } from '../TransactionManager'

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const VERSION = '2.0.0-beta.1'

export interface PenalizeRequest {
  signedTx: PrefixedHexString
}

export interface PenalizerParams {
  transactionManager: TransactionManager
  contractInteractor: ContractInteractor
  txByNonceService: TxByNonceService
  devMode: boolean
}

export class PenalizerService {
  transactionManager: TransactionManager
  contractInteractor: ContractInteractor
  txByNonceService: TxByNonceService
  versionManager: VersionsManager
  devMode: boolean
  initialized: boolean = false

  managerAddress: string

  constructor (params: PenalizerParams) {
    this.transactionManager = params.transactionManager
    this.contractInteractor = params.contractInteractor
    this.versionManager = new VersionsManager(VERSION)
    this.devMode = params.devMode
    this.txByNonceService = params.txByNonceService

    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
  }

  async init (): Promise<void> {
    if (this.initialized) {
      return
    }
    log.setLevel(0)
    // const relayHubTopics = [Object.keys(this.hubContract.contract.events).filter(x => (x.includes('0x')))]
    // this.rhTopics = relayHubTopics.concat([[address2topic(this.keyManager.getAddress(0))]])

    if (this.devMode && (this.contractInteractor.getChainId() < 1000 || this.contractInteractor.getNetworkId() < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(1)
    }

    console.log('Penalizer service initialized')
    this.initialized = true
  }

  // Only handles illegal nonce penalization flow)
  async tryToPenalize (req: PenalizeRequest): Promise<boolean> {
    if (!this.initialized) {
      return false
    }
    // deserialize the tx
    const requestTx = new Transaction(req.signedTx, this.contractInteractor.getRawTxOptions())
    console.log('wtf 1')
    // check signature
    if (!requestTx.verifySignature()) {
      // signature is invalid, cannot penalize
      return false
    }
    console.log('wtf 2')
    // check that it's a registered relay
    const relayWorker = bufferToHex(requestTx.getSenderAddress())
    const relayManager = await this.contractInteractor.relayHubInstance.workerToManager(relayWorker)
    if (isZeroAddress(relayManager)) {
      // unknown worker address to Hub
      return false
    }
    console.log('wtf 3')
    const staked = await this.contractInteractor.relayHubInstance.isRelayManagerStaked(relayManager)
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!staked) {
      // relayManager is not staked so not penalizable
      return false
    }
    console.log('wtf 4')

    // read the relay worker's nonce from blockchain
    const currentNonce = await this.contractInteractor.getTransactionCount(relayWorker, 'pending')
    // if tx nonce > current nonce, publish tx and await
    // otherwise, get mined tx with same nonce. if equals (up to different gasPrice) to received tx, return.
    // Otherwise, penalize.
    if (bufferToInt(requestTx.nonce) <= currentNonce) {
      const txFromHash = await this.contractInteractor.getTransaction(bufferToHex(requestTx.hash(true)))
      if (txFromHash != null) {
        // tx already mined
        return false
      }
      console.log('wtf 5')

      // run penalize in view mode to see if penalizable
      const minedTx = await this.txByNonceService.getTransactionByNonce(relayWorker, bufferToInt(requestTx.nonce))
      if (minedTx == null) {
        console.log('wtf requestTx', requestTx.nonce)
        // @ts-ignore
        throw Error(`TxByNonce service failed to fetch tx with nonce ${bufferToInt(requestTx.nonce)} of relayer ${relayWorker}`)
      }
      console.log('wtf is froms', bufferToHex(minedTx.getSenderAddress()), bufferToHex(requestTx.getSenderAddress()))
      const { data: unsignedMinedTx, signature: minedTxSig } = getDataAndSignature(minedTx, this.contractInteractor.getChainId())
      const { data: unsignedRequestTx, signature: requestTxSig } = getDataAndSignature(requestTx, this.contractInteractor.getChainId())
      console.log('wtf is penalizeRepeatedNonce args', unsignedRequestTx, requestTxSig)
      console.log('wtf is penalizeRepeatedNonce args', unsignedMinedTx, minedTxSig)
      const method = this.contractInteractor.penalizerInstance.contract.methods.penalizeRepeatedNonce(
        unsignedRequestTx, requestTxSig, unsignedMinedTx,
        minedTxSig, this.contractInteractor.relayHubInstance.address)
      try {
        const res = await method.call({
          from: this.managerAddress
        })
        log.debug('res is ', res)
      } catch (e) {
        const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
        log.debug(`view call to penalizeRepeatedNonce reverted with error message ${message}.\nTx not penalizable.`)
        return false
      }
      console.log('wtf 6')
      // Tx penalizable. PokeRelay, Penalize!
      // PokeRelay used penalize, it's not very effective../A critical hit!
      const { signedTx } = await this.transactionManager.sendTransaction(
        {
          signer: this.managerAddress,
          method,
          destination: this.contractInteractor.penalizerInstance.address
        })
      log.debug(`penalization raw tx: ${signedTx}`)
      return true
    }
    console.log('wtf 8')
    return false
  }
}
