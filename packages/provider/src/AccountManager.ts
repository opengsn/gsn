// @ts-ignore
import ethWallet from 'ethereumjs-wallet'
import Web3 from 'web3'
import sigUtil, { EIP712TypedData } from 'eth-sig-util'
import { PrefixedHexString } from 'ethereumjs-util'

import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { TypedRequestData } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { Address, Web3ProviderBaseInterface } from '@opengsn/common/dist/types/Aliases'
import { GSNConfig } from './GSNConfigurator'
import { getEip712Signature, isSameAddress, removeHexPrefix } from '@opengsn/common/dist/Utils'
import { BLSKeypair, BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { ApprovalDataInterface, TypedApprovalData } from '@opengsn/common/dist/bls/TypedApprovalData'
import { toBN } from 'web3-utils'

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
  private readonly blsTypedDataSigner?: BLSTypedDataSigner
  readonly chainId: number
  private blsKeypair?: BLSKeypair

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
    const forwarder = relayRequest.relayData.forwarder

    const cloneRequest = { ...relayRequest }
    const signedData = new TypedRequestData(
      this.chainId,
      forwarder,
      cloneRequest
    )
    return await this.performSigning(relayRequest.request.from, signedData)
  }

  private async performSigning (ethereumAddress: Address, signedData: EIP712TypedData) {
    const keypair = this.accounts.find(account => isSameAddress(account.address, ethereumAddress))

    let signature: PrefixedHexString
    let rec: Address
    try {
      if (keypair != null) {
        signature = this._signWithControlledKey(keypair.privateKey, signedData)
      } else {
        signature = await this._signWithProvider(ethereumAddress, signedData)
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
      throw new Error(`Failed to sign relayed transaction for ${ethereumAddress}: ${error}`)
    }
    if (!isSameAddress(ethereumAddress, rec)) {
      throw new Error(`Internal RelayClient exception: signature is not correct: sender=${ethereumAddress}, recovered=${rec}`)
    }
    return signature
  }

// These methods is extracted to
  // a) allow different implementations in the future, and
  // b) allow spying on Account Manager in tests
  async _signWithProvider (senderAddress: Address, signedData: EIP712TypedData): Promise<string> {
    return await getEip712Signature(
      senderAddress,
      this.web3,
      signedData,
      this.config.methodSuffix,
      this.config.jsonStringifyRequest
    )
  }

  _signWithControlledKey (privateKey: PrefixedHexString, signedData: EIP712TypedData): string {
    // @ts-ignore
    return sigUtil.signTypedData_v4(Buffer.from(removeHexPrefix(privateKey), 'hex'), { data: signedData })
  }

  getAccounts (): string[] {
    return this.accounts.map(it => it.address)
  }

  /**
   * Only a single BLS keypair is currently supported
   * @param blsKeypair
   */
  setBLSKeypair (blsKeypair: BLSKeypair): void {
    this.blsKeypair = blsKeypair
  }

  /**
   * Sign the BLS public key with an ECDSA private key of the user, and also sign the derived Ethereum address
   * with the corresponding BLS private key.
   * @param ethereumAddress
   * @param registrarAddress
   * @returns authorisation - a serialized data used by the Gateway to authorise the public key in the first run
   */
  async createAccountAuthorisation (
    ethereumAddress: Address,
    registrarAddress: Address
  ): Promise<PrefixedHexString> {
    if (this.blsKeypair == null) {
      throw new Error('BLS Keypair is not set in the AccountManager')
    }
    const approvalRequest: ApprovalDataInterface = {
      clientMessage: 'I UNDERSTAND WHAT I AM DOING',
      blsPublicKey0: this.blsKeypair.pubkey[0],
      blsPublicKey1: this.blsKeypair.pubkey[1],
      blsPublicKey2: this.blsKeypair.pubkey[2],
      blsPublicKey3: this.blsKeypair.pubkey[3]
    }
    const signedData = new TypedApprovalData(
      this.chainId,
      registrarAddress,
      approvalRequest
    )
    return await this.performSigning(ethereumAddress, signedData)
  }
}
