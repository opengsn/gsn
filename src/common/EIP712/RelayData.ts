import { Address, IntString } from '../../relayclient/types/Aliases'

export default interface RelayData {
  senderNonce: IntString
  senderAddress: Address
  relayWorker: Address
  paymaster: Address
  forwarder: Address
}
