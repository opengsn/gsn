// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import Web3 from 'web3'
import { PrefixedHexString } from 'ethereumjs-util'
import { RLPEncodedTransaction } from 'web3-core'
import { FeeMarketEIP1559Transaction, Transaction } from '@ethereumjs/tx'
import { personalSign, recoverTypedSignature_v4, signTypedData_v4, TypedMessage } from 'eth-sig-util'

import {
  Address,
  RelayRequest,
  TypedRequestData,
  Web3ProviderBaseInterface,
  getEip712Signature,
  getRawTxOptions,
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
  private readonly web3: Web3
  private readonly accounts: AccountKeypair[] = []
  private readonly config: GSNConfig
  readonly chainId: number

  constructor (provider: Web3ProviderBaseInterface, chainId: number, config: GSNConfig) {
    this.web3 = new Web3(provider as any)
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
    const bufferKey = Buffer.from(removeHexPrefix(keypair.privateKey), 'hex')
    return personalSign(bufferKey, { data: message })
  }

  signTransaction (transactionConfig: TransactionConfig, from: Address): RLPEncodedTransaction {
    let transaction: Transaction | FeeMarketEIP1559Transaction
    if (transactionConfig.chainId != null && transactionConfig.chainId !== this.chainId) {
      throw new Error(`This provider is initialized for chainId ${this.chainId} but transaction targets chainId ${transactionConfig.chainId}`)
    }
    const commonTxOptions = getRawTxOptions(this.chainId, 0)
    const fixGasLimitName = { ...transactionConfig, gasLimit: transactionConfig.gas }
    if (transactionConfig.gasPrice != null) {
      // annoying - '@ethereumjs/tx' imports BN.js@^4.x.x while we use ^5.x.x
      // @ts-ignore
      transaction = new Transaction(fixGasLimitName, commonTxOptions)
    } else {
      // @ts-ignore
      transaction = new FeeMarketEIP1559Transaction(fixGasLimitName, commonTxOptions)
    }
    const privateKeyBuf = Buffer.from(removeHexPrefix(this.findPrivateKey(from)), 'hex')
    const raw = '0x' + transaction.sign(privateKeyBuf).serialize().toString('hex')
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

  async sign (relayRequest: RelayRequest): Promise<PrefixedHexString> {
    let signature
    const forwarder = relayRequest.relayData.forwarder

    const cloneRequest = { ...relayRequest }
    const signedData = new TypedRequestData(
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
      rec = recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to sign relayed transaction for ${relayRequest.request.from}: ${error}`)
    }
    if (!isSameAddress(relayRequest.request.from.toLowerCase(), rec)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Internal RelayClient exception: signature is not correct: sender=${relayRequest.request.from}, recovered=${rec}`)
    }
    return signature
  }

  // These methods is extracted to
  // a) allow different implementations in the future, and
  // b) allow spying on Account Manager in tests
  async _signWithProvider (signedData: any): Promise<string> {
    return await getEip712Signature(
      this.web3,
      signedData,
      this.config.methodSuffix,
      this.config.jsonStringifyRequest
    )
  }

  _signWithControlledKey (privateKey: PrefixedHexString, signedData: TypedMessage<any>): string {
    return signTypedData_v4(Buffer.from(removeHexPrefix(privateKey), 'hex'), { data: signedData })
  }

  getAccounts (): string[] {
    return this.accounts.map(it => it.address)
  }
}
