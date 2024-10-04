import { type Address } from './types/Aliases'

export interface GSNContractsDeployment {
  paymasterAddress?: Address
  relayRegistrarAddress?: Address
  relayHubAddress?: Address
  stakeManagerAddress?: Address
  managerStakeTokenAddress?: Address
}
