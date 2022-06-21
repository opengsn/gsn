import BN from 'bn.js'

import { Address, AsyncScoreCalculator, ContractInteractor, HttpClient, PingResponse } from '@opengsn/common'
import { RelayRegisteredEventInfo } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { RelayFailureInfo } from '@opengsn/common/dist/types/RelayFailureInfo'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'

// enum action = ping, relay, validation

const delay = function <T> (t: number, val: T): Promise<T> {
  return new Promise(resolve => {
    setTimeout(resolve.bind(null, val), t)
  })
}

/**
 * Instance of this class abstracts away all actions and fields that can represent either a "preferred" relay
 * that is originally only known by its URL in a Configuration, or a "registrar" one read from the blockchain.
 */
export class RelayInfo {
  registrarInfo?: RelayRegisteredEventInfo
  pingResponse?: PingResponse
  // ping response may be different for different paymaster addresses
  pingPaymaster?: Address

  // TODO: do I need to differentiate ping and relay and validation failures?
  // maybe:
  // errorByType Map<type: number, failures: string[]>
  pingFailures: RelayFailureInfo[] = []
  relayingFailures: RelayFailureInfo[] = []
  validationFailures: RelayFailureInfo[] = []

  constructor (
    // note that for preferred relays the URL we actually use may be different from the one queried from the Registrar
    readonly usedRelayUrl: string,
    readonly httpClient: HttpClient,
    readonly contractInteractor: ContractInteractor
  ) {}

  static fromUrl (
    relayUrl: string,
    httpClient: HttpClient,
    contractInteractor: ContractInteractor
  ): RelayInfo {
    return new RelayInfo(relayUrl, httpClient, contractInteractor)
  }

  static fromReg (
    registrarInfo: RelayRegisteredEventInfo,
    httpClient: HttpClient,
    contractInteractor: ContractInteractor,
  ): RelayInfo {
    const entity = new RelayInfo(registrarInfo.relayUrl, httpClient, contractInteractor)
    entity.registrarInfo = registrarInfo
    return entity
  }

  onRelayingFailure (error: any) {}

  onValidationFailure (error: any) {}

  // handle ping error/timeout here so no need to have logic outside
  // TODO TBD: cache ping response for some time to optimize
  async ping (timeoutTime: number, relayHub: Address, pingPaymaster?: Address): Promise<boolean> {
    this.pingPaymaster = pingPaymaster
    try {
    const httpPingPromise = await this.httpClient.getPingResponse(this.usedRelayUrl, this.pingPaymaster)
    } catch (error) {
      this.pingFailures.push({
        timestamp: Date.now(),
        errorMessage: 'timed out'
      })
    }
    return true
  }

  _handlePingResponse (relayHub: Address, paymaster?: Address) {

  }

  // attempt relay is not atomic and involves a TON of side effects - validation, audit etc. which are not relay - specific

  async resolveRegistrarDetails () {
    const relayInfo = this.contractInteractor.getRelayInfo(this.pingResponse!.relayManagerAddress)
  }

  hasFailed (maxPingFailuresCount: number, relayTimeoutGrace: number): boolean {
    const now = Date.now()
    const recentFailure = this.pingFailures.find(it => {
      return now - relayTimeoutGrace >= it.timestamp
    })

    return this.pingFailures.length > maxPingFailuresCount ||
      this.relayingFailures.length > 0 ||
      this.validationFailures.length > 0 ||
      recentFailure != null
  }
}
