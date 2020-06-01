import { IntString } from '../../relayclient/types/Aliases'

export default interface GasData {
  gasPrice: IntString
  pctRelayFee: IntString
  baseRelayFee: IntString
}
