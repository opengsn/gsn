// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import { JsonRpcSigner, TransactionRequest } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import { PrefixedHexString } from 'ethereumjs-util'
import { parse } from '@ethersproject/transactions'
import {
  SignTypedDataVersion,
  TypedMessage,
  personalSign,
  recoverTypedSignature,
  signTypedData
} from '@metamask/eth-sig-util'

import {
  Address,
  RelayRequest,
  RLPEncodedTransaction,
  TypedRequestData,
  getEip712Signature,
  isSameAddress,
  removeHexPrefix
} from '@opengsn/common'

import { GSNConfig } from './GSNConfigurator'

export interface AccountKeypair {
  privateKey: PrefixedHexString
  address: Address
}

function toAddress (privateKey: PrefixedHexString): Address {
  const wallet = ethWallet.fromPrivateKey(Buffer.from(removeHexPrefix(privateKey), 'hex'))
  return wallet.getChecksumAddressString()
}

export class AccountManager {
  // private readonly provider: JsonRpcProvider
  private signer: JsonRpcSigner
  private readonly accounts: AccountKeypair[] = []
  private readonly config: GSNConfig
  readonly chainId: number

  constructor (signer: JsonRpcSigner, chainId: number, config: GSNConfig) {
    this.signer = signer
    this.chainId = chainId
    this.config = config
  }

  addAccount (privateKey: PrefixedHexString): AccountKeypair {
    // TODO: backwards-compatibility 101 - remove on next version bump
    // addAccount used to accept AccountKeypair with Buffer in it
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (privateKey.privateKey) {
      console.error('ERROR: addAccount accepts a private key as a prefixed hex string now!')
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      privateKey = `0x${privateKey.privateKey.toString('hex')}`
    }
    const address = toAddress(privateKey)
    const keypair: AccountKeypair = {
      privateKey,
      address
    }
    this.accounts.push(keypair)
    return keypair
  }

  newAccount (): AccountKeypair {
    const a = ethWallet.generate()
    const privateKey = a.getPrivateKeyString()
    this.addAccount(privateKey)
    const address = toAddress(privateKey)
    return {
      privateKey,
      address
    }
  }

  signMessage (message: string, from: Address): PrefixedHexString {
    const keypair = this.accounts.find(account => isSameAddress(account.address, from))
    if (keypair == null) {
      throw new Error(`Account ${from} not found`)
    }
    const privateKey = Buffer.from(removeHexPrefix(keypair.privateKey), 'hex')
    return personalSign({ privateKey, data: message })
  }

  async signTransaction (transactionConfig: TransactionRequest, from: Address): Promise<RLPEncodedTransaction> {
    if (transactionConfig.chainId != null && transactionConfig.chainId !== this.chainId) {
      throw new Error(`This provider is initialized for chainId ${this.chainId} but transaction targets chainId ${transactionConfig.chainId}`)
    }
    const privateKeyBuf = Buffer.from(removeHexPrefix(this.findPrivateKey(from)), 'hex')

    const wallet = new Wallet(privateKeyBuf)

    // if called from Web3.js Provider, the 'transactionConfig' object will have 'gas' field instead of 'gasLimit'
    const gasLimit = transactionConfig.gasLimit ?? (transactionConfig as any).gas
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    const type: number = transactionConfig.type ?? (transactionConfig.maxFeePerGas == null) ? 0 : 2
    const chainId = transactionConfig.chainId ?? this.chainId
    const transactionRequest = Object.assign({}, transactionConfig, { gasLimit, type, chainId })
    delete (transactionRequest as any).gas
    const raw = await wallet.signTransaction(transactionRequest)
    const transaction = parse(raw)
    // even more annoying is that 'RLPEncodedTransaction', which is expected return type here, is not yet 1559-ready
    // @ts-ignore
    return { raw, tx: transaction }
  }

  private findPrivateKey (from: Address): PrefixedHexString {
    const keypair = this.accounts.find(account => isSameAddress(account.address, from))
    if (keypair == null) {
      throw new Error(`Account ${from} not found`)
    }
    return keypair.privateKey
  }

  signTypedData (typedMessage: TypedMessage<any>, from: Address): PrefixedHexString {
    return this._signWithControlledKey(this.findPrivateKey(from), typedMessage)
  }

  async sign (
    domainSeparatorName: string,
    relayRequest: RelayRequest
  ): Promise<PrefixedHexString> {
    let signature
    const forwarder = relayRequest.relayData.forwarder

    const cloneRequest = { ...relayRequest }
    const signedData = new TypedRequestData(
      domainSeparatorName,
      this.chainId,
      forwarder,
      cloneRequest
    )
    const keypair = this.accounts.find(account => isSameAddress(account.address, relayRequest.request.from))
    let rec: Address

    try {
      if (keypair != null) {
        signature = this._signWithControlledKey(keypair.privateKey, signedData)
      } else {
        signature = await this._signWithProvider(signedData)
      }
      // Sanity check only
      rec = recoverTypedSignature({
        data: signedData,
        signature,
        version: SignTypedDataVersion.V4
      })
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to sign relayed transaction for ${relayRequest.request.from}: ${error.message}`)
    }
    if (!isSameAddress(relayRequest.request.from.toLowerCase(), rec)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Internal RelayClient exception: signature is not correct: sender=${relayRequest.request.from}, recovered=${rec}`)
    }
    return signature
  }

  // These methods are extracted to
  // a) allow different implementations in the future, and
  // b) allow spying on Account Manager in tests
  async _signWithProvider (signedData: any): Promise<string> {
    return await getEip712Signature(
      this.signer,
      signedData
    )
  }

  _signWithControlledKey (privateKey: PrefixedHexString, signedData: TypedMessage<any>): string {
    return signTypedData({
      privateKey: Buffer.from(removeHexPrefix(privateKey), 'hex'),
      data: signedData,
      version: SignTypedDataVersion.V4
    })
  }

  getAccounts (): string[] {
    return this.accounts.map(it => it.address)
  }

  switchSigner (signer: JsonRpcSigner): void {
    this.signer = signer
  }
}
