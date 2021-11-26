import BN from 'bn.js'
import { bufferToHex, PrefixedHexString } from 'ethereumjs-util'
import { encode, List } from 'rlp'
import { toBN } from 'web3-utils'

import {
  CalldataCachingResult,
  ICalldataCacheDecoderInteractor
} from './ICalldataCacheDecoderInteractor'

import { Address, IntString, Web3ProviderBaseInterface } from '../types/Aliases'
import { Contract, TruffleContract } from '../LightTruffleContract'
import { ERC20CacheDecoderInstance } from '@opengsn/contracts'

import calldataCacheDecoderAbi from '../interfaces/ICalldataCacheDecoder.json'
import { BatchAddressesCachingResult } from './CacheDecoderInteractor'

export interface ERC20AddressesCachingResult {
  holderAsIds: BN[]
  writeSlotsCount: number
}

enum ERC20MethodSignatures {
  Transfer,
  TransferFrom,
  Approve,
  Mint,
  Burn,
  Permit
}

const ERC20MethodIds = [
  '0xa9059cbb',
  '0x23b872dd',
  '0x095ea7b3',
  '0x00000000',
  '0x00000000',
  '0xd505accf'
]

interface ERC20Call {
  method: ERC20MethodSignatures
  data: { [key: string]: any }
}

export class ERC20CalldataCacheDecoderInteractor implements ICalldataCacheDecoderInteractor {
  private readonly ERC20CacheDecoder: Contract<ERC20CacheDecoderInstance>
  private readonly erc20CacheDecoderAddress: Address

  private erc20CacheDecoder!: ERC20CacheDecoderInstance

  constructor (_: {
    provider: Web3ProviderBaseInterface
    erc20CacheDecoderAddress: Address
  }) {
    this.erc20CacheDecoderAddress = _.erc20CacheDecoderAddress
    this.ERC20CacheDecoder = TruffleContract({
      contractName: 'IRelayHub',
      abi: calldataCacheDecoderAbi
    })
    this.ERC20CacheDecoder.setProvider(_.provider, undefined)
  }

  async init (): Promise<this> {
    this.erc20CacheDecoder = await this.ERC20CacheDecoder.at(this.erc20CacheDecoderAddress)
    return this
  }

  getCalldataCacheDecoderAddress (): Address {
    return this.erc20CacheDecoderAddress
  }

  async compressCalldata (abiEncodedCalldata: PrefixedHexString): Promise<CalldataCachingResult> {
    const erc20Call = this.decodeAbiEncodedERC20Calldata(abiEncodedCalldata)
    return await this.compressErc20Call(erc20Call)
  }

  decodeAbiEncodedERC20Calldata (abiEncodedCalldata: PrefixedHexString): ERC20Call {
    const methodID = abiEncodedCalldata.substr(0, 10)
    const method = ERC20MethodIds.indexOf(methodID)
    if (method === -1) {
      throw new Error(`Failed to compress data for methodID ${methodID}: unknown methodID`)
    }
    const abiEncodedParameters = abiEncodedCalldata.substr(10)
    let data: { [key: string]: any } = {}
    switch (method) {
      case ERC20MethodSignatures.Transfer:
        data = web3.eth.abi.decodeParameters(['address', 'uint256'], abiEncodedParameters)
        break
    }

    return {
      method,
      data
    }
  }

  async compressErc20Call (erc20Call: ERC20Call): Promise<CalldataCachingResult> {
    switch (erc20Call.method) {
      case ERC20MethodSignatures.Transfer:
        return await this.compressErc20Transfer({
          destination: erc20Call.data[0],
          value: erc20Call.data[1]
        })
    }
    throw new Error('not implemented')
  }

  async compressAddressesToIds (addresses: Address[][]): Promise<ERC20AddressesCachingResult> {
    if (addresses.length > 1) {
      throw new Error('Unsupported input for "compressAddressesToIds"')
    }
    return {
      holderAsIds: addresses[0].map(toBN),
      writeSlotsCount: 0
    }
  }

  async compressErc20Transfer (_: { destination: Address, value: IntString }): Promise<CalldataCachingResult> {
    const { holderAsIds: [destinationId], writeSlotsCount } = await this.compressAddressesToIds([[_.destination]])
    const methodSig = toBN(ERC20MethodSignatures.Transfer)
    const list: List = [methodSig, destinationId, toBN(_.value)]
    const cachedEncodedData = bufferToHex(encode(list))
    return {
      cachedEncodedData,
      writeSlotsCount
    }
  }

  async compressErc20Approve (): Promise<CalldataCachingResult> {
    throw new Error('not implemented')
  }
}
