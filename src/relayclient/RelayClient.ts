import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { TransactionReceipt } from 'web3-core'
import Web3 from 'web3'

import RelayRequest from '../common/EIP712/RelayRequest'
import TmpRelayTransactionJsonRequest from './types/TmpRelayTransactionJsonRequest'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import RelayInfo from './types/RelayInfo'
import { Address, AsyncApprove, IntString, PingFilter } from './types/Aliases'
import { defaultEnvironment } from './types/Environments'
import HttpClient from './HttpClient'
import ContractInteractor from './ContractInteractor'
import RelaySelectionManager from './RelaySelectionManager'
import KnownRelaysManager, { EmptyFilter } from './KnownRelaysManager'
import AccountManager from './AccountManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import HttpWrapper from './HttpWrapper'
import { GSNConfig, RelayClientConfig } from './GSNConfigurator'

export const EmptyApprove: AsyncApprove = async (): Promise<string> => {
  return Promise.resolve('0x')
}

export const GasPricePingFilter: PingFilter = (pingResponse, gsnTransactionDetails) => {
  if (
    pingResponse.MinGasPrice != null &&
    gsnTransactionDetails.gasPrice != null &&
    parseInt(pingResponse.MinGasPrice) > parseInt(gsnTransactionDetails.gasPrice)
  ) {
    throw new Error(`Proposed gas price: ${gsnTransactionDetails.gasPrice}; relay's MinGasPrice: ${pingResponse.MinGasPrice}`)
  }
}

interface RelayingAttempt {
  transaction?: Transaction
  error?: Error
}

export interface RelayingResult {
  transaction?: Transaction
  pingErrors: Map<string, Error>
  relayingErrors: Map<string, Error>
}

export default class RelayClient {
  private readonly config: RelayClientConfig
  private readonly web3: Web3
  private readonly httpClient: HttpClient
  private readonly contractInteractor: ContractInteractor
  private readonly knownRelaysManager: KnownRelaysManager
  private readonly accountManager: AccountManager
  private readonly relayHub: Address
  private readonly asyncApprove: AsyncApprove
  private readonly relayedTransactionValidator: RelayedTransactionValidator
  private readonly pingFilter: PingFilter

  /**
   * create a RelayClient library object, to force contracts to go through a relay.
   * @param web3  - the web3 instance to use.
   * @param httpClient
   * @param contractInteractor
   * @param knownRelaysManager
   * @param accountManager
   * @param relayedTransactionValidator
   * @param pingFilter
   * @param config options
   * @param relayHub
   * @param asyncApprove
   */
  constructor (
    web3: Web3,
    httpClient: HttpClient,
    contractInteractor: ContractInteractor,
    knownRelaysManager: KnownRelaysManager,
    accountManager: AccountManager,
    relayedTransactionValidator: RelayedTransactionValidator,
    relayHub: Address,
    pingFilter: PingFilter,
    asyncApprove: AsyncApprove,
    config: RelayClientConfig
  ) {
    this.config = config
    this.web3 = web3
    this.httpClient = httpClient
    this.contractInteractor = contractInteractor
    this.knownRelaysManager = knownRelaysManager
    this.relayedTransactionValidator = relayedTransactionValidator
    this.accountManager = accountManager
    this.pingFilter = pingFilter
    this.relayHub = relayHub
    this.asyncApprove = asyncApprove
  }

  /**
   * Create an instance of {@link RelayClient} with all default implementations of its dependencies.
   * @param web3
   * @param gsnConfig
   */
  static new (web3: Web3, gsnConfig: GSNConfig): RelayClient {
    const httpWrapper = new HttpWrapper()
    const httpClient = new HttpClient(httpWrapper, { verbose: false })
    const contractInteractor = new ContractInteractor(web3.currentProvider, gsnConfig.contractInteractorConfig)
    const knownRelaysManager = new KnownRelaysManager(web3, gsnConfig.relayHubAddress, contractInteractor, EmptyFilter, gsnConfig.knownRelaysManagerConfig)
    const accountManager = new AccountManager(web3, defaultEnvironment.chainId, gsnConfig.accountManagerConfig)
    const transactionValidator = new RelayedTransactionValidator(contractInteractor, gsnConfig.relayHubAddress, defaultEnvironment.chainId, gsnConfig.transactionValidatorConfig)
    return new RelayClient(web3, httpClient, contractInteractor, knownRelaysManager, accountManager, transactionValidator, gsnConfig.relayHubAddress, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
  }

  /**
   * In case Relay Server does not broadcast the signed transaction to the network,
   * client also broadcasts the same transaction. If the transaction fails with nonce
   * error, it indicates Relay may have signed multiple transactions with same nonce,
   * causing a DoS attack.
   *
   * @param {*} transaction - actual Ethereum transaction, signed by a relay
   */
  async _broadcastRawTx (transaction: Transaction): Promise<{ receipt?: TransactionReceipt, broadcastError?: Error, wrongNonce?: boolean }> {
    const rawTx = '0x' + transaction.serialize().toString('hex')
    const txHash = '0x' + transaction.hash(true).toString('hex')
    if (this.config.verbose) {
      console.log('txHash= ' + txHash)
    }
    try {
      const receipt = await this.web3.eth.sendSignedTransaction(rawTx)
      return { receipt }
    } catch (broadcastError) {
      // don't display error for the known-good cases
      if (broadcastError?.message.match(/the tx doesn't have the correct nonce|known transaction/) != null) {
        return { wrongNonce: true, broadcastError }
      }
      return { broadcastError }
    }
  }

  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    // TODO: should have a better strategy to decide how often to refresh known relays
    await this.knownRelaysManager.refresh()
    gsnTransactionDetails.gasPrice = gsnTransactionDetails.forceGasPrice ?? await this._calculateGasPrice()
    if (gsnTransactionDetails.gasPrice == null) {
      gsnTransactionDetails.gas = await this._calculateGasPrice()
    }
    if (gsnTransactionDetails.gas == null) {
      const estimated = await this.web3.eth.estimateGas(gsnTransactionDetails)
      gsnTransactionDetails.gas = estimated.toString()
    }
    const relaySelectionManager = new RelaySelectionManager(gsnTransactionDetails, this.knownRelaysManager, this.httpClient, this.pingFilter, this.config.verbose)
    const relayingErrors = new Map<string, Error>()
    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay != null) {
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails)
        if (relayingAttempt.transaction == null) {
          relayingErrors.set(activeRelay.eventInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          continue
        }
      }
      return {
        transaction: relayingAttempt?.transaction,
        relayingErrors,
        pingErrors: relaySelectionManager.errors
      }
    }
  }

  async _calculateGasPrice (): Promise<IntString> {
    const pct: number = this.config.gasPriceFactorPercent
    const networkGasPrice = await this.web3.eth.getGasPrice()
    let gasPrice = Math.round(parseInt(networkGasPrice) * (pct + 100) / 100).toString()
    if (this.config.minGasPrice != null && parseInt(gasPrice) < parseInt(this.config.minGasPrice)) {
      gasPrice = this.config.minGasPrice
    }
    return gasPrice
  }

  async _attemptRelay (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayingAttempt> {
    const { relayRequest, approvalData, signature, httpRequest } =
      await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)
    const acceptRelayCallResult = await this.contractInteractor.validateAcceptRelayCall(relayRequest, signature, approvalData, this.relayHub)
    if (!acceptRelayCallResult.success) {
      return { error: new Error(`canRelay failed: ${acceptRelayCallResult.returnValue}`) }
    }
    let hexTransaction: PrefixedHexString
    try {
      hexTransaction = await this.httpClient.relayTransaction(relayInfo.eventInfo.relayUrl, httpRequest)
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.eventInfo.relayManager, relayInfo.eventInfo.relayUrl)
      }
      if (this.config.verbose) {
        console.log('relayTransaction: ', JSON.stringify(httpRequest))
      }
      return { error }
    }
    const transaction = new Transaction(hexTransaction)
    if (!this.relayedTransactionValidator.validateRelayResponse(httpRequest, hexTransaction)) {
      this.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.eventInfo.relayManager, relayInfo.eventInfo.relayUrl)
      return { error: new Error('Returned transaction did not pass validation') }
    }
    await this._broadcastRawTx(transaction)
    return {
      transaction
    }
  }

  async _prepareRelayHttpRequest (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<{ relayRequest: RelayRequest, relayMaxNonce: number, approvalData: PrefixedHexString, signature: PrefixedHexString, httpRequest: TmpRelayTransactionJsonRequest }> {
    const senderNonce = await this.contractInteractor.getSenderNonce(gsnTransactionDetails.from, gsnTransactionDetails.forwarder)
    const relayWorker = relayInfo.pingResponse.RelayServerAddress
    const gasPrice = gsnTransactionDetails.gasPrice
    const gasLimit = gsnTransactionDetails.gas
    if (gasPrice == null || gasLimit == null) {
      throw new Error('RelayClient internal exception. Gas price or gas limit still not calculated. Cannot happen.')
    }
    const relayRequest = new RelayRequest({
      senderAddress: gsnTransactionDetails.from,
      target: gsnTransactionDetails.to,
      encodedFunction: gsnTransactionDetails.data,
      senderNonce,
      pctRelayFee: relayInfo.eventInfo.pctRelayFee,
      baseRelayFee: relayInfo.eventInfo.baseRelayFee,
      gasPrice: gasPrice,
      gasLimit: gasLimit,
      paymaster: gsnTransactionDetails.paymaster,
      relayWorker
    })

    const signature = await this.accountManager.sign(relayRequest, gsnTransactionDetails.forwarder)
    const approvalData = await this.asyncApprove(relayRequest)
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const transactionCount = await this.web3.eth.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    // TODO: the server accepts a flat object, and that is why this code looks like shit.
    //  Must teach server to accept correct types
    const httpRequest = {
      relayWorker: relayInfo.pingResponse.RelayServerAddress,
      encodedFunction: gsnTransactionDetails.data,
      senderNonce: relayRequest.relayData.senderNonce,
      from: gsnTransactionDetails.from,
      to: gsnTransactionDetails.to,
      pctRelayFee: relayInfo.eventInfo.pctRelayFee,
      baseRelayFee: relayInfo.eventInfo.baseRelayFee,
      gasPrice,
      gasLimit,
      paymaster: gsnTransactionDetails.paymaster,
      signature,
      approvalData,
      relayHubAddress: this.relayHub,
      relayMaxNonce
    }
    return {
      relayRequest,
      relayMaxNonce,
      approvalData,
      signature,
      httpRequest
    }
  }
}
