// TODO: use this class in sever code
import { Address, IntString } from '../relayclient/types/Aliases'

export default interface PingResponse {
  // TODO: this should be 'worker'
  RelayServerAddress: Address
  MinGasPrice: IntString
  Ready: boolean
  Version: string
}
