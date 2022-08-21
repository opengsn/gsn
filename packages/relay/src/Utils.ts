import { EventData } from 'web3-eth-contract'
import { ServerConfigParams } from './ServerConfigParams'
import { Address, isSameAddress, packRelayUrlForRegistrar } from '@opengsn/common'

export function isRegistrationValid (registerEvent: EventData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  return registerEvent != null &&
    isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
    packRelayUrlForRegistrar(registerEvent.returnValues.relayUrl) === config.url
}
