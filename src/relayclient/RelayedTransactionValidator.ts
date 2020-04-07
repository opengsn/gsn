import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { bufferToHex, ecrecover, pubToAddress } from 'ethereumjs-util'
import RelayRequest from '../common/EIP712/RelayRequest'
import { isSameAddress } from '../common/utils'
import ContractInteractor from './ContractInteractor'
import TmpRelayTransactionJsonRequest from './types/TmpRelayTransactionJsonRequest'
import { Address } from './types/Aliases'

export default class RelayedTransactionValidator {
  private readonly contractInteractor: ContractInteractor
  private readonly chainId: number
  private readonly config: { verbose: boolean }
  private readonly relayHubAddress: Address

  constructor (contractInteractor: ContractInteractor, relayHubAddress: Address, chainId: number, config: { verbose: boolean }) {
    this.contractInteractor = contractInteractor
    this.config = config
    this.chainId = chainId
    this.relayHubAddress = relayHubAddress
  }

  /**
   * Decode the signed transaction returned from the Relay Server, compare it to the
   * requested transaction and validate its signature.
   * @returns a signed {@link Transaction} instance for broadcasting, or null if returned
   * transaction is not valid.
   */
  validateRelayResponse (
    transactionJsonRequest: TmpRelayTransactionJsonRequest,
    returnedTx: PrefixedHexString
  ): boolean {
    const transaction = new Transaction(returnedTx)

    if (this.config.verbose) {
      console.log('returnedTx is', transaction.v, transaction.r, transaction.s, transaction.to, transaction.data, transaction.gasLimit, transaction.gasPrice, transaction.value)
    }

    const message = transaction.hash(false)
    const signer = bufferToHex(pubToAddress(ecrecover(message, transaction.v[0], transaction.r, transaction.s, this.chainId)))

    const relayRequestOrig = new RelayRequest({
      senderAddress: transactionJsonRequest.senderAddress,
      target: transactionJsonRequest.target,
      encodedFunction: transactionJsonRequest.encodedFunction,
      gasPrice: transactionJsonRequest.gasPrice,
      gasLimit: transactionJsonRequest.gasLimit,
      baseRelayFee: transactionJsonRequest.baseRelayFee,
      pctRelayFee: transactionJsonRequest.pctRelayFee,
      senderNonce: transactionJsonRequest.senderNonce,
      relayWorker: transactionJsonRequest.relayWorker,
      paymaster: transactionJsonRequest.paymaster
    })

    const relayRequestAbiEncode = this.contractInteractor.encodeABI(relayRequestOrig, transactionJsonRequest.signature, transactionJsonRequest.approvalData)

    if (
      isSameAddress(bufferToHex(transaction.to), this.relayHubAddress) &&
      relayRequestAbiEncode === bufferToHex(transaction.data) &&
      isSameAddress(transactionJsonRequest.relayWorker, signer)
    ) {
      if (this.config.verbose) {
        console.log('validateRelayResponse - valid transaction response')
      }

      const receivedNonce = transaction.nonce.readUIntBE(0, transaction.nonce.byteLength)
      if (receivedNonce > transactionJsonRequest.relayMaxNonce) {
        // TODO: need to validate that client retries the same request and doesn't double-spend.
        // Note that this transaction is totally valid from the EVM's point of view

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Relay used a tx nonce higher than requested. Requested ${transactionJsonRequest.relayMaxNonce} got ${receivedNonce}`)
      }

      return true
    } else {
      console.error('validateRelayResponse: req', relayRequestAbiEncode, this.relayHubAddress, transactionJsonRequest.relayWorker)
      console.error('validateRelayResponse: rsp', bufferToHex(transaction.data), bufferToHex(transaction.to), signer)
      return false
    }
  }
}
