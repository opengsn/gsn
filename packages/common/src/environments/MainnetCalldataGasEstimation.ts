import { PrefixedHexString } from 'ethereumjs-util'

import { CalldataGasEstimation } from '../types/Aliases'
import { calculateCalldataBytesZeroNonzero } from '../Utils'
import { Environment } from './Environments'

/**
 * On the Ethereum Mainnet, the transaction cost is currently determined by the EIP-2028.
 * In case different coefficients are used later or in different chains, the values are read from the Environment.
 * @param calldata
 * @param environment
 * @constructor
 */
export const MainnetCalldataGasEstimation: CalldataGasEstimation = async (
  calldata: PrefixedHexString,
  environment: Environment
): Promise<number> => {
  const { calldataZeroBytes, calldataNonzeroBytes } = calculateCalldataBytesZeroNonzero(calldata)
  return environment.mintxgascost + calldataZeroBytes * environment.gtxdatazero +
    calldataNonzeroBytes * environment.gtxdatanonzero
}
