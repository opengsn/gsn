import { EventData } from 'web3-eth-contract'
import { ServerConfigParams } from './ServerConfigParams'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { isSameAddress } from '@opengsn/common/dist/Utils'
import { packRelayUrlForRegistrar } from '@opengsn/common'

export function isRegistrationValid (registerEvent: EventData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  return registerEvent != null &&
    isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
    registerEvent.returnValues.baseRelayFee.toString() === config.baseRelayFee.toString() &&
    registerEvent.returnValues.pctRelayFee.toString() === config.pctRelayFee.toString() &&
    packRelayUrlForRegistrar(registerEvent.returnValues.relayUrl) === config.url
}
