import { Address } from './types/Aliases'

export interface GSNContractsDeployment {
  forwarderAddress?: Address
  paymasterAddress?: Address
  penalizerAddress?: Address
  relayRegistrarAddress?: Address
  relayHubAddress?: Address
  stakeManagerAddress?: Address
  managerStakeTokenAddress?: Address
}
