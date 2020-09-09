// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import RelayRequest from '../common/EIP712/RelayRequest'
import sigUtil from 'eth-sig-util'
import { getEip712Signature, isSameAddress } from '../common/Utils'
import { Address } from './types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'
import { GSNConfig } from './GSNConfigurator'
import { HttpProvider } from 'web3-core'
import Web3 from 'web3'
import TypedRequestData from '../common/EIP712/TypedRequestData'

require('source-map-support').install({ errorFormatterForce: true })
export interface AccountKeypair {
  privateKey: Buffer
  address: Address
}

function toAddress (wallet: any): string {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  return `0x${wallet.getAddress().toString('hex')}`
}
export default class AccountManager {
  private readonly web3: Web3
  private readonly accounts: AccountKeypair[] = []
  private readonly config: GSNConfig
  readonly chainId: number

  constructor (provider: HttpProvider, chainId: number, config: GSNConfig) {
    this.web3 = new Web3(provider)
    this.chainId = chainId
    this.config = config
  }

  addAccount (keypair: AccountKeypair): void {
    const wallet = ethWallet.fromPrivateKey(keypair.privateKey)
    if (!isSameAddress(toAddress(wallet), keypair.address)) {
      throw new Error('invalid keypair')
    }
    this.accounts.push(keypair)
  }

  newAccount (): AccountKeypair {
    const a = ethWallet.generate()
    const keypair = {
      privateKey: a.privKey,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      address: toAddress(a)
    }
    this.addAccount(keypair)
    return keypair
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
        signature = this._signWithControlledKey(keypair, signedData)
      } else {
        signature = await this._signWithProvider(signedData)
      }
      // Sanity check only
      // @ts-ignore
      rec = sigUtil.recoverTypedSignature_v4({
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
      this.config.methodSuffix ?? '',
      this.config.jsonStringifyRequest ?? false
    )
  }

  _signWithControlledKey (keypair: AccountKeypair, signedData: TypedRequestData): string {
    // @ts-ignore
    return sigUtil.signTypedData_v4(keypair.privateKey, { data: signedData })
  }

  getAccounts (): string[] {
    return this.accounts.map(it => it.address)
  }
}
