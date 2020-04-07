import RelayRequest from '../common/EIP712/RelayRequest'
import getDataToSign from '../common/EIP712/Eip712Helper'
import sigUtil from 'eth-sig-util'
import { getEip712Signature, isSameAddress } from '../common/utils'
import { Address } from './types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export interface AccountKeypair {
  privateKey: Buffer
  address: Address
}

/**
 * @field methodSuffix - allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
 * @field jsonStringifyRequest - should be 'true' for Metamask, false for ganache
 */
export interface AccountManagerConfig {
  verbose: boolean
  methodSuffix: string
  jsonStringifyRequest: boolean
}

export default class AccountManager {
  private readonly web3: Web3
  private readonly accounts: AccountKeypair[] = []
  private readonly config: AccountManagerConfig
  private readonly chainId: number

  constructor (web3: Web3, chainId: number, config: AccountManagerConfig) {
    this.web3 = web3
    this.chainId = chainId
    this.config = config
  }

  addAccount (keypair: AccountKeypair): void {
    this.accounts.push(keypair)
  }

  // TODO: make forwarder part of RelayRequest, why is it dangling??
  async sign (relayRequest: RelayRequest, forwarderAddress: Address): Promise<PrefixedHexString> {
    let signature
    const signedData = await getDataToSign({
      chainId: this.chainId,
      verifier: forwarderAddress,
      relayRequest
    })
    const keypair = this.accounts.find(account => isSameAddress(account.address, relayRequest.relayData.senderAddress))
    if (keypair != null) {
      // @ts-ignore
      signature = sigUtil.signTypedData_v4(this.ephemeralKeypair.privateKey, { data: signedData })
    } else {
      signature = await getEip712Signature(
        {
          web3: this.web3,
          methodSuffix: this.config.methodSuffix ?? '',
          jsonStringifyRequest: this.config.jsonStringifyRequest ?? false,
          dataToSign: signedData
        })
    }
    // Sanity check only
    // @ts-ignore
    const rec = sigUtil.recoverTypedSignature_v4({
      data: signedData,
      sig: signature
    })
    if (!isSameAddress(relayRequest.relayData.senderAddress.toLowerCase(), rec)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`signature error: sender=${relayRequest.relayData.senderAddress}, recovered=${rec}`)
    }
    return signature
  }
}
