import { Address } from '../../relayclient/types/Aliases'
import RelayRequest from './RelayRequest'
import { EIP712Domain, EIP712TypedData, EIP712TypeProperty, EIP712Types } from 'eth-sig-util'

const EIP712DomainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const GasDataType = [
  { name: 'gasPrice', type: 'uint256' },
  { name: 'pctRelayFee', type: 'uint256' },
  { name: 'baseRelayFee', type: 'uint256' }
]

const RelayDataType = [
  { name: 'relayWorker', type: 'address' },
  { name: 'paymaster', type: 'address' }
]

const RelayRequestType = [
  { name: 'target', type: 'address' },
  { name: 'encodedFunction', type: 'bytes' },
  { name: 'senderAddress', type: 'address' },
  { name: 'senderNonce', type: 'uint256' },
  { name: 'gasLimit', type: 'uint256' },
  { name: 'forwarder', type: 'address' },
  { name: 'gasData', type: 'GasData' },
  { name: 'relayData', type: 'RelayData' }
]

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  RelayRequest: EIP712TypeProperty[]
  GasData: EIP712TypeProperty[]
  RelayData: EIP712TypeProperty[]
}

export default class TypedRequestData implements EIP712TypedData {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: RelayRequest

  constructor (
    chainId: number,
    verifier: Address,
    relayRequest: RelayRequest) {
    this.types = {
      EIP712Domain: EIP712DomainType,
      RelayRequest: RelayRequestType,
      GasData: GasDataType,
      RelayData: RelayDataType
    }
    this.domain = {
      name: 'GSN Relayed Transaction',
      version: '1',
      chainId: chainId,
      verifyingContract: verifier
    }
    this.primaryType = 'RelayRequest'
    this.message = relayRequest
  }
}
