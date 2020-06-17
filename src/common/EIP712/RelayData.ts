import {Address, IntString} from '../../relayclient/types/Aliases'

export default interface RelayData {
  gasPrice: IntString
  pctRelayFee: IntString
  baseRelayFee: IntString
  relayWorker: Address
  paymaster: Address
  forwarder: Address
}
