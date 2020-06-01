import { Address } from '../../relayclient/types/Aliases'

export default interface RelayData {
  relayWorker: Address
  paymaster: Address
}
