import { IntString } from './Aliases'

export default interface RelayClientConfig {
  verbose: boolean
  gasPriceFactorPercent?: number
  minGasPrice?: IntString
  maxGasPrice?: IntString
  maxRelayNonceGap?: number
}
