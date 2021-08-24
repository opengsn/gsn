// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import Web3 from 'web3'
import sigUtil from 'eth-sig-util'
import { PrefixedHexString } from 'ethereumjs-util'

import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { TypedRequestData } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { Address, Web3ProviderBaseInterface } from '@opengsn/common/dist/types/Aliases'
import { GSNConfig } from './GSNConfigurator'
import { getEip712Signature, isSameAddress, removeHexPrefix } from '@opengsn/common/dist/Utils'

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

  addAccount (privateKey: PrefixedHexString): void {
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
  }

  newAccount (): AccountKeypair {
    const a = ethWallet.generate()
    const privateKey = `0x${(a.privKey as Buffer).toString('hex')}`
    this.addAccount(privateKey)
    const address = toAddress(privateKey)
    return {
      privateKey,
      address
    }
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
      // @ts-ignore
      rec = sigUtil.recoverTypedSignature_v4({
        // @ts-ignore
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

  _signWithControlledKey (privateKey: PrefixedHexString, signedData: TypedRequestData): string {
    // @ts-ignore
    return sigUtil.signTypedData_v4(Buffer.from(removeHexPrefix(privateKey), 'hex'), { data: signedData })
  }

  getAccounts (): string[] {
    return this.accounts.map(it => it.address)
  }
}
