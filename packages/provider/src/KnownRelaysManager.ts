import {
  Address,
  ContractInteractor,
  LoggerInterface,
  RegistrarRelayInfo,
  RelayFailureInfo,
  RelayFilter,
  validateRelayUrl,
  isSameAddress,
  shuffle
} from '@opengsn/common'

import { GSNConfig } from './GSNConfigurator'

import { RelayInfoUrl } from '@opengsn/common/dist/types/GSNContractsDataTypes'

export const DefaultRelayFilter: RelayFilter = function (registrarRelayInfo: RegistrarRelayInfo): boolean {
  return true
}

export class KnownRelaysManager {
  private readonly contractInteractor: ContractInteractor
  private readonly logger: LoggerInterface
  private readonly config: GSNConfig
  private readonly relayFilter: RelayFilter

  private relayFailures = new Map<string, RelayFailureInfo[]>()

  public preferredRelayers: RelayInfoUrl[] = []
  public allRelayers: RegistrarRelayInfo[] = []

  constructor (contractInteractor: ContractInteractor, logger: LoggerInterface, config: GSNConfig, relayFilter?: RelayFilter) {
    this.config = config
    this.logger = logger
    this.relayFilter = relayFilter ?? DefaultRelayFilter
    this.contractInteractor = contractInteractor
  }

  async refresh (): Promise<void> {
    this._refreshFailures()
    this.preferredRelayers = this.config.preferredRelays.map(relayUrl => {
      return { relayUrl }
    })
    this.allRelayers = await this.getRelayInfoForManagers()
  }

  getRelayInfoForManager (address: string): RegistrarRelayInfo | undefined {
    return this.allRelayers.find(info => isSameAddress(info.relayManager, address))
  }

  async getRelayInfoForManagers (): Promise<RegistrarRelayInfo[]> {
    const relayInfos: RegistrarRelayInfo[] = await this.contractInteractor.getRegisteredRelays()
    this.logger.info(`fetchRelaysAdded: found ${relayInfos.length} relays`)

    const blacklistFilteredRelayInfos = relayInfos.filter((info: RegistrarRelayInfo) => {
      const isHostBlacklisted = this.config.blacklistedRelays.find(relay => info.relayUrl.toLowerCase().includes(relay.toLowerCase())) != null
      const isManagerBlacklisted = this.config.blacklistedRelays.find(relay => isSameAddress(info.relayManager, relay)) != null
      return !(isHostBlacklisted || isManagerBlacklisted)
    })
    const filteredRelayInfos = blacklistFilteredRelayInfos.filter(this.relayFilter)
    if (filteredRelayInfos.length !== relayInfos.length) {
      this.logger.warn(`RelayFilter: removing ${relayInfos.length - filteredRelayInfos.length} relays from results`)
    }
    return filteredRelayInfos
  }

  _refreshFailures (): void {
    const newMap = new Map<string, RelayFailureInfo[]>()
    this.relayFailures.forEach((value: RelayFailureInfo[], key: string) => {
      newMap.set(key, value.filter(failure => {
        const elapsed = (new Date().getTime() - failure.lastErrorTime) / 1000
        return elapsed < this.config.relayTimeoutGrace
      }))
    })
    this.relayFailures = newMap
  }

  async getRelaysShuffledForTransaction (): Promise<RelayInfoUrl[][]> {
    const sortedRelays: RelayInfoUrl[][] = []
    // preferred relays are copied as-is, unsorted (we don't have any info about them anyway to sort)
    sortedRelays[0] = Array.from(this.preferredRelayers)
    const hasFailure = (it: RegistrarRelayInfo): boolean => { return this.relayFailures.get(it.relayUrl) != null }
    const relaysWithFailures = this.allRelayers.filter(hasFailure)
    const relaysWithoutFailures = this.allRelayers.filter(it => {
      return !hasFailure(it)
    })
    sortedRelays[1] = shuffle(relaysWithoutFailures)
    sortedRelays[2] = shuffle(relaysWithFailures)
    for (let i = 0; i < sortedRelays.length; i++) {
      const queriedRelaysSize = sortedRelays[i].length
      sortedRelays[i] = sortedRelays[i].filter(it => validateRelayUrl(it.relayUrl))
      if (sortedRelays[i].length < queriedRelaysSize) {
        this.logger.info(`getRelaysShuffledForTransaction (${i}): filtered out ${queriedRelaysSize - sortedRelays[i].length} relays without a public URL or a public URL that is not valid`)
      }
    }
    return sortedRelays
  }

  getAuditors (excludeUrls: string[]): string[] {
    if (this.config.auditorsCount === 0) {
      this.logger.debug('skipping audit step as "auditorsCount" config parameter is set to 0')
      return []
    }
    const indexes: number[] = []
    const auditors: string[] = []
    const flatRelayers =
      [...this.preferredRelayers, ...this.allRelayers]
        .map(it => it.relayUrl)
        .filter(it => !excludeUrls.includes(it))
        .filter((value, index, self) => {
          return self.indexOf(value) === index
        })
    if (flatRelayers.length <= this.config.auditorsCount) {
      if (flatRelayers.length < this.config.auditorsCount) {
        this.logger.warn(`Not enough auditors: request ${this.config.auditorsCount} but only have ${flatRelayers.length}`)
      }
      return flatRelayers
    }
    do {
      const index = Math.floor(Math.random() * flatRelayers.length)
      if (!indexes.includes(index)) {
        auditors.push(flatRelayers[index])
        indexes.push(index)
      }
    } while (auditors.length < this.config.auditorsCount)
    return auditors
  }

  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void {
    const relayFailures = this.relayFailures.get(relayUrl)
    const newFailureInfo = {
      lastErrorTime,
      relayManager,
      relayUrl
    }
    if (relayFailures == null) {
      this.relayFailures.set(relayUrl, [newFailureInfo])
    } else {
      relayFailures.push(newFailureInfo)
    }
  }

  isPreferred (relayUrl: string): boolean {
    return this.preferredRelayers.find(it => it.relayUrl.toLowerCase() === relayUrl.toLowerCase()) != null
  }
}
