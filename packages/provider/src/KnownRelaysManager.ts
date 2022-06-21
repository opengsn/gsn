// import BN from 'bn.js'
// import { AsyncScoreCalculator, RelayFilter } from '@opengsn/common/dist/types/Aliases'
// import { GSNConfig } from './GSNConfigurator'
// import { RegisteredRelayInfo} from '@opengsn/common/dist/types/GSNContractsDataTypes'
// import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
// import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
//
// export const DefaultRelayFilter: RelayFilter = function (registeredEventInfo: RegisteredRelayInfo): boolean {
//   const maxPctRelayFee = 100
//   const maxBaseRelayFee = 1e17
//   return !(
//     parseInt(registeredEventInfo.pctRelayFee) > maxPctRelayFee ||
//     parseInt(registeredEventInfo.baseRelayFee) > maxBaseRelayFee)
//
// }
//
export function randomInRangeBN (min: BN, max: BN): BN {
  return max.sub(min).muln(Math.random()).add(min)
}
//
// export class KnownRelaysManager {
//   private readonly contractInteractor: ContractInteractor
//   private readonly logger: LoggerInterface
//   private readonly config: GSNConfig
//
//   // private relayFailures = new Map<string, RelayFailureInfo[]>()
//
//   public preferredRelayers: string[] = []
//   public allRelayersFromRegistrar: RelayRegisteredEventInfo[] = []
//
//   constructor (contractInteractor: ContractInteractor, logger: LoggerInterface, config: GSNConfig, relayFilter?: RelayFilter, scoreCalculator?: AsyncScoreCalculator) {
//     this.config = config
//     this.logger = logger
//     this.relayFilter = relayFilter ?? DefaultRelayFilter
//     this.contractInteractor = contractInteractor
//   }
//
//   // async refresh (): Promise<void> {
//   //   this._refreshFailures()
//   //   this.preferredRelayers = this.config.preferredRelays.map(relayUrl => {
//   //     return { relayUrl }
//   //   })
//   //   this.allRelayersFromRegistrar = await this.getRelayInfoForManagers()
//   // }
//
//   //
//   //
//   // _refreshFailures (): void {
//   //   const newMap = new Map<string, RelayFailureInfo[]>()
//   //   this.relayFailures.forEach((value: RelayFailureInfo[], key: string) => {
//   //     newMap.set(key, value.filter(failure => {
//   //       const elapsed = (new Date().getTime() - failure.lastErrorTime) / 1000
//   //       return elapsed < this.config.relayTimeoutGrace
//   //     }))
//   //   })
//   //   this.relayFailures = newMap
//   // }
//   //
//   // async getRelaysSortedForTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayInfoUrl[][]> {
//   //   const sortedRelays: RelayInfoUrl[][] = []
//   //   // preferred relays are copied as-is, unsorted (we don't have any info about them anyway to sort)
//   //   sortedRelays[0] = Array.from(this.preferredRelayers)
//   //   sortedRelays[1] = this.allRelayersFromRegistrar
//   //   sortedRelays[2] = [] // TODO: once failed, relays end up in the third group
//   //   return sortedRelays
//   // }
//
//   // async _sortRelaysInternal (gsnTransactionDetails: GsnTransactionDetails, activeRelays: RelayInfoUrl[]): Promise<RelayInfoUrl[]> {
//   //   const scores = new Map<string, BN>()
//   //   for (const activeRelay of activeRelays) {
//   //     let score = toBN(0)
//   //     if (isInfoFromEvent(activeRelay)) {
//   //       const eventInfo = activeRelay as RelayRegisteredEventInfo
//   //       score = await this.scoreCalculator(eventInfo, gsnTransactionDetails, this.relayFailures.get(activeRelay.relayUrl) ?? [])
//   //       // score = toBN(0)
//   //       scores.set(eventInfo.relayManager, score)
//   //     }
//   //   }
//   //   return Array
//   //     .from(activeRelays.values())
//   //     .filter(isInfoFromEvent)
//   //     .map(value => (value as RelayRegisteredEventInfo))
//   //     .sort((a, b) => {
//   //       const aScore = scores.get(a.relayManager)?.toString() ?? '0'
//   //       const bScore = scores.get(b.relayManager)?.toString() ?? '0'
//   //       return toBN(bScore).cmp(toBN(aScore))
//   //     })
//   // }
//
//   // saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void {
//   //   const relayFailures = this.relayFailures.get(relayUrl)
//   //   const newFailureInfo = {
//   //     lastErrorTime,
//   //     relayManager,
//   //     relayUrl
//   //   }
//   //   if (relayFailures == null) {
//   //     this.relayFailures.set(relayUrl, [newFailureInfo])
//   //   } else {
//   //     relayFailures.push(newFailureInfo)
//   //   }
//   // }
//   //
//   // isPreferred (relayUrl: string): boolean {
//   //   return this.preferredRelayers.find(it => it.relayUrl.toLowerCase() === relayUrl.toLowerCase()) != null
//   // }
// }
