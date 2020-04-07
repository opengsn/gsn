// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { TransactionReceipt } from 'web3-core'

import RelayRequest from '../common/EIP712/RelayRequest'

import HttpClient from './HttpClient'
import ContractInteractor from './ContractInteractor'
import RelaySelectionManager from './RelaySelectionManager'
import RelayInfo from './types/RelayInfo'
import KnownRelaysManager from './KnownRelaysManager'
import AccountManager, { AccountKeypair } from './AccountManager'
import RelayClientConfig from './types/RelayClientConfig'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { Address, AsyncApprove, PingFilter } from './types/Aliases'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import RelayFailureInfo from './types/RelayFailureInfo'

// default gas price (unless client specifies one): the web3.eth.gasPrice*(100+GASPRICE_PERCENT)/100
const GASPRICE_PERCENT = 20

const MAX_RELAY_NONCE_GAP = 3

export function newEphemeralKeypair (): AccountKeypair {
  const a = ethWallet.generate()
  return {
    privateKey: a.privKey,
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    address: `0x${a.getAddress().toString('hex')}`
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

  /**
   * create a RelayClient library object, to force contracts to go through a relay.
   * @param web3  - the web3 instance to use.
   * @param httpClient
   * @param contractInteractor
   * @param knownRelaysManager
   * @param accountManager
   * @param relayedTransactionValidator
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
    config: RelayClientConfig,
    relayHub: Address,
    asyncApprove: AsyncApprove
  ) {
    this.config = config
    this.web3 = web3
    this.httpClient = httpClient
    this.contractInteractor = contractInteractor
    this.knownRelaysManager = knownRelaysManager
    this.relayedTransactionValidator = relayedTransactionValidator
    this.accountManager = accountManager
    this.relayHub = relayHub
    this.asyncApprove = asyncApprove
  }

  /**
   * In case Relay Server does not broadcast the signed transaction to the network,
   * client also broadcasts the same transaction. If the transaction fails with nonce
   * error, it indicates Relay may have signed multiple transactions with same nonce,
   * causing a DoS attack.
   *
   * @param {*} transaction - actual Ethereum transaction, signed by a relay
   */
  async _broadcastRawTx (transaction: Transaction): Promise<TransactionReceipt> {
    const rawTx = '0x' + transaction.serialize().toString('hex')
    const txHash = '0x' + transaction.hash(true).toString('hex')
    if (this.config.verbose) {
      console.log('txHash= ' + txHash)
    }
    return this.web3.eth.sendSignedTransaction(rawTx, function (error: Error | null, hash: string) {
      // don't display error for the known-good cases
      if (error !== null && error.message.match(/the tx doesn't have the correct nonce|known transaction/) === null) {
        console.log('broadcastTx: ', error, hash)
      }
    })
  }

  /**
   * Options include standard transaction params: from,to, gas_price, gas_limit
   * relay-specific params:
   *  pctRelayFee (override config.pctRelayFee)
   *  validateCanRelay - client calls canRelay before calling the relay the first time (defaults to true)
   *  paymaster - the contract that is compensating the relay for the gas (defaults to transaction destination 'to')
   * can also override default relayUrl, relayFee
   * return value is the same as from sendTransaction
   */
  async runRelay (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    // TODO: should have a better strategy to decide how often to refresh known relays
    await this.knownRelaysManager.refresh()

    const pct: number = this.config.gasPriceFactorPercent ?? GASPRICE_PERCENT
    const networkGasPrice = await this.web3.eth.getGasPrice()
    let gasPrice = Math.round(parseInt(networkGasPrice) * (pct + 100) / 100).toString()
    if (this.config.minGasPrice != null && parseInt(gasPrice) < parseInt(this.config.minGasPrice)) {
      gasPrice = this.config.minGasPrice
    }
    const pingFilter: PingFilter = pingResponse => {
      if (pingResponse.MinGasPrice != null && parseInt(pingResponse.MinGasPrice) > parseInt(gasPrice)) {
        throw new Error(`Proposed gas price: ${gasPrice}; relay's MinGasPrice: ${pingResponse.MinGasPrice}`)
      }
    }
    const relaySelectionManager = new RelaySelectionManager(this.knownRelaysManager, this.httpClient, pingFilter, this.config.verbose)
    // TODO: should add gas estimation for encodedFunction (tricky, since its not a real transaction)
    const relayingErrors = new Map<string, Error>()
    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay != null) {
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails, gasPrice)
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

  async _attemptRelay (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails,
    gasPrice: string
  ): Promise<RelayingAttempt> {
    const { relayRequest, relayMaxNonce, approvalData, signature } =
      await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)
    const request = {
      relayWorker: relayInfo.pingResponse.RelayServerAddress,
      encodedFunction: gsnTransactionDetails.data,
      senderNonce: relayRequest.relayData.senderNonce,
      senderAddress: gsnTransactionDetails.from,
      target: gsnTransactionDetails.to,
      pctRelayFee: relayInfo.eventInfo.pctRelayFee,
      baseRelayFee: relayInfo.eventInfo.baseRelayFee,
      gasPrice,
      gasLimit: gsnTransactionDetails.gas,
      paymaster: gsnTransactionDetails.paymaster,
      signature,
      approvalData,
      relayHubAddress: this.relayHub,
      relayMaxNonce
    }
    const acceptRelayCallResult = await this.contractInteractor.validateAcceptRelayCall(relayRequest, signature, approvalData, this.relayHub)
    if (!acceptRelayCallResult.success) {
      return { error: new Error(`canRelay failed: ${acceptRelayCallResult.returnValue}`) }
    }
    let hexTransaction: PrefixedHexString
    try {
      hexTransaction = await this.httpClient.relayTransaction(relayInfo.eventInfo.relayUrl, request)
    } catch (error) {
      if (error.indexOf('timeout') !== -1) {
        this.knownRelaysManager.saveRelayFailure(
          new RelayFailureInfo(new Date().getTime(), relayInfo.eventInfo.relayManager, relayInfo.eventInfo.relayUrl)
        )
      }
      if (this.config.verbose) {
        console.log('relayTransaction: ', JSON.stringify(request))
      }
      return { error }
    }
    const transaction = new Transaction(hexTransaction)
    if (!this.relayedTransactionValidator.validateRelayResponse(request, hexTransaction)) {
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
  ): Promise<{ relayRequest: RelayRequest, relayMaxNonce: number, approvalData: PrefixedHexString, signature: PrefixedHexString }> {
    const senderNonce = await this.contractInteractor.getSenderNonce(gsnTransactionDetails.from, gsnTransactionDetails.forwarder)
    const relayWorker = relayInfo.pingResponse.RelayServerAddress
    const relayRequest = new RelayRequest({
      senderAddress: gsnTransactionDetails.from,
      target: gsnTransactionDetails.to,
      encodedFunction: gsnTransactionDetails.data,
      senderNonce,
      pctRelayFee: relayInfo.eventInfo.pctRelayFee,
      baseRelayFee: relayInfo.eventInfo.baseRelayFee,
      gasPrice: gsnTransactionDetails.gasPrice,
      gasLimit: gsnTransactionDetails.gas,
      paymaster: gsnTransactionDetails.paymaster,
      relayWorker
    })

    const signature = await this.accountManager.sign(relayRequest, gsnTransactionDetails.forwarder)
    const approvalData = await this.asyncApprove(relayRequest)
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const allowedRelayNonceGap: number = this.config.maxRelayNonceGap ?? MAX_RELAY_NONCE_GAP
    const transactionCount = await this.web3.eth.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + allowedRelayNonceGap
    return {
      relayRequest,
      relayMaxNonce,
      approvalData,
      signature
    }
  }
}
