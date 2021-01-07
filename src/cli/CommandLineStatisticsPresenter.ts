// @ts-ignore
import EthVal from 'ethval'
import Table from 'cli-table'
import * as asciichart from 'asciichart'
import colors from 'colors'
import terminalLink from 'terminal-link'

import {
  EventTransactionInfo,
  GSNStatistics, PaymasterInfo, RelayHubConstructorParams, RelayHubEvents,
  RelayServerInfo,
  RelayServerRegistrationInfo,
  RelayServerRegistrationStatus
} from './GSNStatistics'
import { GSNContractsDeployment } from '../common/GSNContractsDeployment'
import { Address, IntString, ObjectMap, SemVerString } from '../common/types/Aliases'
import {
  RelayRegisteredEventInfo,
  TransactionRejectedByPaymasterEventInfo,
  TransactionRelayedEventInfo
} from '../common/types/GSNContractsDataTypes'
import moment from 'moment'
import { CommandLineStatisticsPresenterConfig } from './CommandLineStatisticsPresenterConfig'

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
    if (deployment.versionRegistryAddress != null) {
      table.push({ 'Version Registry': [deployment.versionRegistryAddress, versions[deployment.versionRegistryAddress ?? '']] })
    }
    table.push({ 'Stake Manager': [this.addressToLink(deployment.stakeManagerAddress), this.ethValueStr(balances[deployment.stakeManagerAddress ?? '']), versions[deployment.stakeManagerAddress ?? '']] })
    table.push({ 'Penalizer ': [this.addressToLink(deployment.penalizerAddress), this.ethValueStr(balances[deployment.penalizerAddress ?? '']), versions[deployment.penalizerAddress ?? '']] })
    table.push({ 'Relay Hub': [this.addressToLink(deployment.relayHubAddress), this.ethValueStr(balances[deployment.relayHubAddress ?? '']), versions[deployment.relayHubAddress ?? '']] })
    return table.toString()
  }

  addressToLink (address: Address = ''): string {
    let truncatedAddress = address.slice(0, this.config.addressTruncateToLength + 2)
    if (this.config.addressTruncateToLength < 20) {
      truncatedAddress += '…'
    }
    if (this.config.blockExplorerUrl == null) {
      return truncatedAddress
    }
    const url = this.config.blockExplorerUrl + 'address/' + address
    if (!terminalLink.isSupported) {
      return url
    }
    return terminalLink(truncatedAddress, url)
  }

  // TODO: deduplicate!
  txHashToLink (txHash: string): string {
    let truncatedAddress = txHash.slice(0, this.config.addressTruncateToLength + 2)
    if (this.config.addressTruncateToLength < 20) {
      truncatedAddress += '…'
    }
    if (this.config.blockExplorerUrl == null) {
      return truncatedAddress
    }
    const url = this.config.blockExplorerUrl + 'tx/' + txHash
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
    const activeRelays = relayServerInfos.filter(it => it.currentStatus === RelayServerRegistrationStatus.REGISTERED)
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
      const fee = this.createFeeSubTable(relayServerInfo.registrationInfo)
      const authorizedHubs = this.createAuthorizedHubsSubTable(relayServerInfo)
      const recentChart = this.createRecentTransactionsChart(currentBlock, relayServerInfo.relayHubEvents.transactionRelayedEvents, relayServerInfo.relayHubEvents.transactionRejectedEvents)
      const registrationRenewals = this.createRegistrationRenewalsSubTable(currentBlock, relayServerInfo.relayHubEvents.relayRegisteredEvents)
      table.push([host, pingStatus, addressesAndBalances, fee, authorizedHubs, recentChart, registrationRenewals])
    }
    return table.toString()
  }

  printNonActiveServersInfo (currentBlock: number, relayServerInfos: RelayServerInfo[]): string {
    const nonActiveRelays = relayServerInfos.filter(it => it.currentStatus !== RelayServerRegistrationStatus.REGISTERED)
    if (nonActiveRelays.length === 0) {
      return 'no non-active relays found'
    }
    const table = new Table({ head: ['MGR', 'Status', 'First Seen', 'Last Seen', 'Total Relayed'] })
    for (const relay of nonActiveRelays) {
      const status = this.stringServerStatus(relay.currentStatus)
      const managerAddressLink = this.addressToLink(relay.managerAddress)
      const firstSeen = 'TODO'
      const lastSeen = 'TODO'
      const totalTx = relay.relayHubEvents.transactionRelayedEvents.length
      table.push([managerAddressLink, status, firstSeen, lastSeen, totalTx])
    }
    return table.toString()
  }

  createAddressesAndBalancesSubTable (relayServerInfo: RelayServerInfo): string {
    const table = new Table({ head: ['Role', 'Address', 'Balance'] })
    table.push(['OWN', this.addressToLink(relayServerInfo.stakeInfo.owner), this.ethValueStr(relayServerInfo.ownerBalance)])
    table.push(['MGR', this.addressToLink(relayServerInfo.managerAddress), this.ethValueStr(relayServerInfo.managerBalance)])
    for (const workerAddress of relayServerInfo.registrationInfo?.registeredWorkers ?? []) {
      const workerBalance = this.ethValueStr(relayServerInfo.registrationInfo?.workerBalances[workerAddress])
      table.push(['W#1', this.addressToLink(workerAddress), workerBalance])
    }
    const table2 = new Table()
    const relayHubEarningsBalance = this.ethValueStr(relayServerInfo.relayHubEarningsBalance)
    const totalDepositedStake = this.ethValueStr(relayServerInfo.stakeInfo.stake)
    table2.push(['RelayHub earnings ', relayHubEarningsBalance])
    table2.push(['Deposited Stake', totalDepositedStake])
    return table.toString() + '\n' + table2.toString()
  }

  createFeeSubTable (registrationInfo: RelayServerRegistrationInfo): string {
    const table = new Table({ head: ['Base', 'Percent'] })
    table.push([this.ethValueStr(registrationInfo.lastRegisteredBaseFee, 'gwei'), `${registrationInfo.lastRegisteredPctFee}%`])
    return table.toString()
  }

  createAuthorizedHubsSubTable (relayServerInfo: RelayServerInfo): string {
    const table = new Table({ head: ['Address', 'Version'] })
    for (const hub of Object.keys(relayServerInfo.authorizedHubs)) {
      table.push([this.addressToLink(hub), relayServerInfo.authorizedHubs[hub]])
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
        return `${x} `
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
      if (event.eventData.blockNumber < weekBeginningBlockApprox) {
        continue
      }
      // TODO: Ok, this is shit. If the event is in the CURRENT block, it will 'floor' to 7 while last index is 6. Reconsider this code.
      const index = Math.min(Math.floor((event.eventData.blockNumber - weekBeginningBlockApprox) / this.config.averageBlocksPerDay), this.config.daysToPlotTransactions - 1)
      eventsByDay[index]++
    }
    return eventsByDay
  }

  stringServerStatus (status: RelayServerRegistrationStatus): string {
    switch (status) {
      case RelayServerRegistrationStatus.REGISTERED:
        return 'registered'
      case RelayServerRegistrationStatus.STAKED:
        return 'staked'
      case RelayServerRegistrationStatus.WITHDRAWN:
        return 'withdrawn'
      case RelayServerRegistrationStatus.UNLOCKED:
        return 'unlocked'
      case RelayServerRegistrationStatus.PENALIZED:
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

      const link = this.txHashToLink(event.eventData.transactionHash)
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
      const address = this.addressToLink(paymaster.address)
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
      ['Max paymaster deposit', this.ethValueStr(params.maximumRecipientDeposit)],
      ['Minimum stake', this.ethValueStr(params.minimumStake)],
      ['Gas Reserve', params.gasReserve],
      ['Post Overhead', params.postOverhead],
      ['Gas Overhead', params.gasOverhead]
    )
    return table.toString()
  }
}
