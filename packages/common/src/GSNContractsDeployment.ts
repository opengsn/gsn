import { Address, SemVerString } from './types/Aliases'

export interface GSNContractsDeployment {
  paymasterVersion?: SemVerString
  forwarderAddress?: Address
  paymasterAddress?: Address
  penalizerAddress?: Address
  relayHubAddress?: Address
  stakeManagerAddress?: Address
  versionRegistryAddress?: Address
}
