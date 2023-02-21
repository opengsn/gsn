import { PrefixedHexString } from 'ethereumjs-util'

import { CalldataGasEstimation } from '../types/Aliases'
import { Environment } from './Environments'
import { constants } from '../Constants'
import { JsonRpcProvider } from '@ethersproject/providers'

/**
 * In most L2s, the cost of the transaction is dynamic and depends on L1 gas price.
 * This function tries to extract calldata cost by requesting an estimate but setting target to zero address.
 * As our result must be above the Relay Server's estimate, it makes sense to add some slack to the estimate.
 * @param calldata
 * @param environment
 * @param calldataEstimationSlackFactor
 * @param provider
 * @constructor
 */
export const AsyncZeroAddressCalldataGasEstimation: CalldataGasEstimation = async (
  calldata: PrefixedHexString,
  environment: Environment,
  calldataEstimationSlackFactor: number,
  provider: JsonRpcProvider
): Promise<number> => {
  const estimateGasCallToZero = await provider.estimateGas({
    to: constants.ZERO_ADDRESS,
    data: calldata
  })
  return parseInt(estimateGasCallToZero.toString()) * calldataEstimationSlackFactor
}
