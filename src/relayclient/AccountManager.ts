// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import RelayRequest from '../common/EIP712/RelayRequest'
import getDataToSign from '../common/EIP712/Eip712Helper'
import sigUtil from 'eth-sig-util'
import { getEip712Signature, isSameAddress } from '../common/utils'
import { Address } from './types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'
import { GSNConfig } from './GSNConfigurator'
import { HttpProvider } from 'web3-core'
import Web3 from 'web3'

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
  private readonly chainId: number

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

  // TODO: make forwarder part of RelayRequest, why is it dangling??
  async sign (relayRequest: RelayRequest, forwarderAddress: Address): Promise<PrefixedHexString> {
    let signature
    const signedData = getDataToSign({
      chainId: this.chainId,
      verifier: forwarderAddress,
      relayRequest
    })
    const keypair = this.accounts.find(account => isSameAddress(account.address, relayRequest.relayData.senderAddress))
    if (keypair != null) {
      signature = this._signWithControlledKey(keypair, signedData)
    } else {
      signature = await this._signWithProvider(signedData)
    }
    // Sanity check only
    let rec: Address
    try {
      // @ts-ignore
      rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to sign relayed transaction for ${relayRequest.relayData.senderAddress}`)
    }
    if (!isSameAddress(relayRequest.relayData.senderAddress.toLowerCase(), rec)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Internal RelayClient exception: signature is not correct: sender=${relayRequest.relayData.senderAddress}, recovered=${rec}`)
    }
    return signature
  }

  // These methods is extracted to
  // a) allow different implementations in the future, and
  // b) allow spying on Account Manager in tests
  async _signWithProvider (signedData: any): Promise<string> {
    return getEip712Signature(
      {
        web3: this.web3,
        methodSuffix: this.config.methodSuffix ?? '',
        jsonStringifyRequest: this.config.jsonStringifyRequest ?? false,
        dataToSign: signedData
      })
  }

  _signWithControlledKey (keypair: AccountKeypair, signedData: any): string {
    // @ts-ignore
    return sigUtil.signTypedData_v4(keypair.privateKey, { data: signedData })
  }
}
