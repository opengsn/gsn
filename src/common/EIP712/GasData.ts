import { IntString } from '../../relayclient/types/Aliases'

export default interface GasData {
  gasLimit: IntString
  gasPrice: IntString
  pctRelayFee: IntString
  baseRelayFee: IntString
}
