// TODO: use this class in sever code
import { Address, IntString } from '../relayclient/types/Aliases'

export default interface PingResponse {
  // TODO: this should be 'worker'
  RelayServerAddress: Address
  RelayManagerAddress: Address
  RelayHubAddress: Address
  MinGasPrice: IntString
  MaxAcceptanceBudget: IntString
  Ready: boolean
  Version: string
}
