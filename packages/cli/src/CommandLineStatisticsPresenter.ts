// @ts-ignore
import EthVal from 'ethval'
import Table from 'cli-table'
import colors from 'colors'
import moment from 'moment'
import terminalLink from 'terminal-link'
import { PrefixedHexString } from 'ethereumjs-util'
import * as asciichart from 'asciichart'

import { GSNContractsDeployment, IntString, ObjectMap, SemVerString } from '@opengsn/common'

import { CommandLineStatisticsPresenterConfig } from './CommandLineStatisticsPresenterConfig'

import {
  EventTransactionInfo,
  GSNStatistics,
  PaymasterInfo,
  RelayHubConstructorParams,
  RelayHubEvents,
  RelayServerInfo,
  RelayServerStakeStatus
} from '@opengsn/common/dist/types/GSNStatistics'

import {
  RelayRegisteredEventInfo,
  TransactionRejectedByPaymasterEventInfo,
  TransactionRelayedEventInfo
} from '@opengsn/common/dist/types/GSNContractsDataTypes'

export class CommandLineStatisticsPresenter {
  config: CommandLineStatisticsPresenterConfig

  constructor (config: CommandLineStatisticsPresenterConfig) {
    this.config = config
  }

  getStatisticsStringPresentation (statistics: GSNStatistics): string {
    let message: string = `GSN status for version ${statistics.runtimeVersion} on ChainID ${statistics.chainId} at block height ${statistics.blockNumber}\n\n`
    message += this.createContractsDeploymentTable(statistics.contractsDeployment, statistics.deploymentBalances, statistics.deploymentVersions)

    message += '\n\nRelay Hub constructor parameters:\n'
    message += this.printRelayHubConstructorParams(statistics.relayHubConstructorParams)

    message += '\n\nTransactions:\n'
    message += this.printTransactionsPlot(statistics.blockNumber, statistics.relayHubEvents)

    message += '\n\nActive Relays:\n'
    message += this.printActiveServersInfo(statistics.blockNumber, statistics.relayServers)

    message += '\n\nNon-active Relays:\n'
    message += this.printNonActiveServersInfo(statistics.blockNumber, statistics.relayServers)

    message += '\n\nPaymasters:\n'
    message += this.printPaymastersInfo(statistics.blockNumber, statistics.paymasters)
    return message
  }

  createContractsDeploymentTable (deployment: GSNContractsDeployment, balances: ObjectMap<IntString>, versions: ObjectMap<SemVerString>): string {
    const table = new Table({ head: ['', 'Address', 'Balance', 'Version'] })
    table.push({ 'Stake Manager': [this.toBlockExplorerLink(deployment.stakeManagerAddress, true), this.ethValueStr(balances[deployment.stakeManagerAddress ?? '']), versions[deployment.stakeManagerAddress ?? '']] })
    table.push({ 'Penalizer ': [this.toBlockExplorerLink(deployment.penalizerAddress, true), this.ethValueStr(balances[deployment.penalizerAddress ?? '']), versions[deployment.penalizerAddress ?? '']] })
    table.push({ 'Relay Hub': [this.toBlockExplorerLink(deployment.relayHubAddress, true), this.ethValueStr(balances[deployment.relayHubAddress ?? '']), versions[deployment.relayHubAddress ?? '']] })
    return table.toString()
  }

  toBlockExplorerLink (value: PrefixedHexString = '', isAddress: boolean = true): string {
    let truncatedAddress = value.slice(0, this.config.urlTruncateToLength + 2)
    if (this.config.urlTruncateToLength < value.length) {
      truncatedAddress += '…'
    }
    if (this.config.blockExplorerUrl == null) {
      return truncatedAddress
    }
    const type = isAddress ? 'address/' : 'tx/'
    const url = this.config.blockExplorerUrl + type + value
    if (!terminalLink.isSupported) {
      return url
    }
    return terminalLink(truncatedAddress, url)
  }

  /**
   * Converts amount in wei to a human-readable string
   * @param value - amount in wei
   * @param units - units to convert to; only full 1e18 unit ('eth') will be replaced with ticker symbol
   */
  ethValueStr (value: IntString = '0', units: string = 'eth'): string {
    const valueStr: string = new EthVal(value).to(units).toFixed(this.config.valuesTruncateToLength)
    const unitString = units === 'eth' ? this.config.nativeTokenTickerSymbol : units
    return `${valueStr} ${unitString}`
  }

  printTransactionsPlot (
    currentBlock: number,
    relayHubEvents: RelayHubEvents): string {
    return this.createRecentTransactionsChart(currentBlock, relayHubEvents.transactionRelayedEvents, relayHubEvents.transactionRejectedEvents)
  }

  printActiveServersInfo (currentBlock: number, relayServerInfos: RelayServerInfo[]): string {
    const activeRelays = relayServerInfos.filter(it => it.isRegistered)
    if (activeRelays.length === 0) {
      return 'no active relays found'
    }
    const table = new Table({ head: ['Host', 'Ping status', 'Addresses & balances', 'Fee', 'Authorized Hubs', 'Transactions', 'Registration renewals'] })
    for (const relayServerInfo of activeRelays) {
      if (relayServerInfo.registrationInfo == null) {
        throw new Error('registrationInfo not initialized for a registered relay')
      }
      const host = new URL(relayServerInfo.registrationInfo.lastRegisteredUrl).host

      // TODO: process errors into human-readable status
      const pingStatus =
        relayServerInfo.registrationInfo.pingResult.pingResponse != null
          ? relayServerInfo.registrationInfo.pingResult.pingResponse.ready.toString().substr(0, 20)
          : relayServerInfo.registrationInfo.pingResult.error?.toString().substr(0, 20) ??
          'unknown'
      const addressesAndBalances = this.createAddressesAndBalancesSubTable(relayServerInfo)
      const authorizedHubs = this.createAuthorizedHubsSubTable(relayServerInfo)
      const recentChart = this.createRecentTransactionsChart(currentBlock, relayServerInfo.relayHubEvents.transactionRelayedEvents, relayServerInfo.relayHubEvents.transactionRejectedEvents)
      const registrationRenewals = this.createRegistrationRenewalsSubTable(currentBlock, relayServerInfo.relayHubEvents.relayRegisteredEvents)
      table.push([host, pingStatus, addressesAndBalances, authorizedHubs, recentChart, registrationRenewals])
    }
    return table.toString()
  }

  printNonActiveServersInfo (currentBlock: number, relayServerInfos: RelayServerInfo[]): string {
    const nonActiveRelays = relayServerInfos.filter(it => !it.isRegistered)
    if (nonActiveRelays.length === 0) {
      return 'no non-active relays found'
    }
    const table = new Table({ head: ['Manager address', 'Status', 'First Seen', 'Last Seen', 'Total Relayed'] })
    for (const relay of nonActiveRelays) {
      const status = this.stringServerStatus(relay.stakeStatus)
      const managerAddressLink = this.toBlockExplorerLink(relay.managerAddress, true)
      const firstSeen = 'TODO'
      const lastSeen = 'TODO'
      const totalTx = relay.relayHubEvents.transactionRelayedEvents.length
      table.push([managerAddressLink, status, firstSeen, lastSeen, totalTx])
    }
    return table.toString()
  }

  createAddressesAndBalancesSubTable (relayServerInfo: RelayServerInfo): string {
    const table = new Table({ head: ['Role', 'Address', 'Balance'] })
    table.push(['OWN', this.toBlockExplorerLink(relayServerInfo.stakeInfo.owner, true), this.ethValueStr(relayServerInfo.ownerBalance)])
    table.push(['MGR', this.toBlockExplorerLink(relayServerInfo.managerAddress, true), this.ethValueStr(relayServerInfo.managerBalance)])
    for (const workerAddress of relayServerInfo.registrationInfo?.registeredWorkers ?? []) {
      const workerBalance = this.ethValueStr(relayServerInfo.registrationInfo?.workerBalances[workerAddress])
      table.push(['W#1', this.toBlockExplorerLink(workerAddress, true), workerBalance])
    }
    const table2 = new Table()
    const relayHubEarningsBalance = this.ethValueStr(relayServerInfo.relayHubEarningsBalance)
    const totalDepositedStake = this.ethValueStr(relayServerInfo.stakeInfo.stake.toString())
    table2.push(['RelayHub earnings ', relayHubEarningsBalance])
    table2.push(['Deposited Stake', totalDepositedStake])
    return table.toString() + '\n' + table2.toString()
  }

  createAuthorizedHubsSubTable (relayServerInfo: RelayServerInfo): string {
    const table = new Table({ head: ['Address', 'Version'] })
    for (const hub of Object.keys(relayServerInfo.authorizedHubs)) {
      table.push([this.toBlockExplorerLink(hub, true), relayServerInfo.authorizedHubs[hub]])
    }
    return table.toString()
  }

  createRecentTransactionsChart (
    currentBlock: number,
    transactionRelayedEvents: Array<EventTransactionInfo<TransactionRelayedEventInfo>>,
    transactionRejectedEvents: Array<EventTransactionInfo<TransactionRejectedByPaymasterEventInfo>>
  ): string {
    if (transactionRelayedEvents.length === 0 && transactionRejectedEvents.length === 0) {
      return 'no transactions'
    }
    const config = {
      colors: [
        asciichart.green,
        asciichart.red
      ],
      format: function (x: number) {
        return `${x.toString().padStart(3, '0')} `
      }
    }
    // this code is ugly af but does work with negative 'beginning block'
    const weekBeginningBlockApprox = currentBlock - this.config.averageBlocksPerDay * this.config.daysToPlotTransactions
    const relayedByDay = this.getEventsByDayCount(transactionRelayedEvents, weekBeginningBlockApprox)
    const rejectedByDay = this.getEventsByDayCount(transactionRejectedEvents, weekBeginningBlockApprox)
    // @ts-ignore
    let plot = asciichart.plot([relayedByDay, rejectedByDay], config)
    plot += `\n${colors.green('accepted')} ${colors.red('rejected')}`
    return plot
  }

  getEventsByDayCount (transactionRelayedEvents: Array<EventTransactionInfo<TransactionRelayedEventInfo | TransactionRejectedByPaymasterEventInfo>>, weekBeginningBlockApprox: number): number[] {
    const eventsByDay: number[] = new Array(this.config.daysToPlotTransactions).fill(0)
    for (const event of transactionRelayedEvents) {
      if (event.eventData.blockNumber <= weekBeginningBlockApprox) {
        continue
      }
      // If the event is in the CURRENT block, it will 'floor' to 7 while last index is 6
      const index = Math.floor((event.eventData.blockNumber - weekBeginningBlockApprox - 1) / this.config.averageBlocksPerDay)
      eventsByDay[index]++
    }
    return eventsByDay
  }

  stringServerStatus (status: RelayServerStakeStatus): string {
    switch (status) {
      case RelayServerStakeStatus.STAKE_LOCKED:
        return 'stake locked'
      case RelayServerStakeStatus.STAKE_WITHDRAWN:
        return 'withdrawn'
      case RelayServerStakeStatus.STAKE_UNLOCKED:
        return 'unlocked'
      case RelayServerStakeStatus.STAKE_PENALIZED:
        return 'penalized'
    }
  }

  createRegistrationRenewalsSubTable (
    currentBlock: number,
    relayRegisteredEvents: Array<EventTransactionInfo<RelayRegisteredEventInfo>>): string {
    const table = new Table({ head: ['Link', 'Block number', 'Time estimate'] })
    for (const event of relayRegisteredEvents) {
      const eventBlock = event.eventData.blockNumber
      const estimateDays = (currentBlock - eventBlock) / this.config.averageBlocksPerDay
      const blockMoment = moment().subtract(estimateDays, 'days')

      const link = this.toBlockExplorerLink(event.eventData.transactionHash, false)
      table.push([link, eventBlock, blockMoment.fromNow()])
    }
    return table.toString()
  }

  printPaymastersInfo (blockNumber: number, paymasters: PaymasterInfo[]): string {
    if (paymasters.length === 0) {
      return 'no paymasters found'
    }
    const table = new Table({ head: ['Address', 'Hub balance', 'Transactions accepted', 'Transaction rejected'] })
    const paymastersSortedSliced = paymasters.sort((a, b) => b.acceptedTransactionsCount - a.acceptedTransactionsCount)
      .slice(0, 10)
    for (const paymaster of paymastersSortedSliced) {
      const address = this.toBlockExplorerLink(paymaster.address, true)
      const balance = this.ethValueStr(paymaster.relayHubBalance)
      table.push([address, balance, paymaster.acceptedTransactionsCount, paymaster.rejectedTransactionsCount])
    }
    let string = table.toString()
    if (paymasters.length > 10) {
      string += `\n and ${paymasters.length - 10} more...`
    }
    return string
  }

  printRelayHubConstructorParams (params: RelayHubConstructorParams): string {
    const table = new Table()
    table.push(
      ['Max worker count', params.maxWorkerCount],
      ['Minimum unstake delay', `${params.minimumUnstakeDelay} blocks`],
      ['Gas Reserve', params.gasReserve],
      ['Post Overhead', params.postOverhead],
      ['Gas Overhead', params.gasOverhead]
    )
    return table.toString()
  }
}
