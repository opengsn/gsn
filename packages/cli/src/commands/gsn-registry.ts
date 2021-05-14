import { CommandsLogic } from '../CommandsLogic'
import DateFormatter from 'date-format'
import {
  getMnemonic,
  getNetworkUrl,
  getRegistryAddress,
  gsnCommander
} from '../utils'
import { VersionInfo, VersionRegistry } from '@opengsn/common/dist/VersionRegistry'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { toWei } from 'web3-utils'
import { createCommandsLogger } from '../CommandsWinstonLogger'
import { GSNContractsDeployment } from '@opengsn/common'

function error (s: string): never {
  console.error(s)
  process.exit(1)
}

function parseTime (t: string): number {
  const m = t.match(/^\s*([\d.]+)\s*([smhdw]?)/i)
  if (m == null) error('invalid --delay parameter: must be number with sec/min/hour/day suffix')
  const n = parseFloat(m[1])
  switch (m[2].toLowerCase()) {
    case 'm':
      return n * 60
    case 'h':
      return n * 3600
    case 'd':
      return n * 3600 * 24
    case 'w':
      return n * 3600 * 24 * 7
    default: // either 'sec' or nothing
      return n
  }
}

const commander = gsnCommander(['n', 'f', 'm', 'g'])
  .option('--registry <address>', 'versionRegistry')
  .option('-i, --id <string>', 'id to edit/change')
  .option('--list', 'list all registered ids')
  .option('-d, --delay <string>', 'view latest version that is at least that old (sec/min/hour/day)', '0')
  .option('-h, --history', 'show all version history')
  .option('-V, --ver <string>', 'new version to add/cancel')
  .option('-d, --date', 'show date info of versions')
  .option('-a, --add <string>', 'add this version value. if not set, show current value')
  .option('-C, --cancel', 'cancel the given version')
  .option('-r, --reason <string>', 'cancel reason')
  .parse(process.argv)

function formatVersion (id: string, versionInfo: VersionInfo, showDate = false): string {
  const dateInfo = showDate ? `[${DateFormatter('yyyy-MM-dd hh:mm', new Date(versionInfo.time * 1000))}] ` : ''
  return `${id} @ ${versionInfo.version} = ${dateInfo} ${versionInfo.value} ${versionInfo.canceled ? `- CANCELED ${versionInfo.cancelReason}` : ''}`.trim()
}

(async () => {
  const nodeURL = getNetworkUrl(commander.network)

  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic)
  const provider = (logic as any).web3.currentProvider
  const versionRegistryAddress = getRegistryAddress(commander.registry) ?? error('must specify --registry')
  console.log('Using registry at address: ', versionRegistryAddress)
  const deployment: GSNContractsDeployment = {
    versionRegistryAddress
  }
  const maxPageSize = Number.MAX_SAFE_INTEGER
  const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize })
  const versionRegistry = new VersionRegistry(1, contractInteractor)
  if (!await versionRegistry.isValid()) {
    error(`Not a valid registry address: ${versionRegistryAddress}`)
  }

  if (commander.args.length > 0) {
    error('unexpected param(s): ' + commander.args.join(', '))
  }

  if (commander.list != null) {
    const ids = await versionRegistry.listIds()
    console.log('All registered IDs:')
    ids.forEach(id => console.log('-', id))
    return
  }

  const id: string = commander.id ?? error('must specify --id')
  const add = commander.add as (string | undefined)
  const cancel = commander.cancel

  const version: string | undefined = commander.ver
  if (add == null && cancel == null) {
    // view mode

    if (version != null) {
      error('cannot specify --ver without --add or --cancel')
    }
    const showDate = commander.date
    if (commander.history != null) {
      if (commander.delay !== '0') error('cannot specify --delay and --history')
      console.log((await versionRegistry.getAllVersions(id)).map(v => formatVersion(id, v, showDate)))
    } else {
      const delayPeriod = parseTime(commander.delay)
      console.log(formatVersion(id, await versionRegistry.getVersion(id, delayPeriod), showDate))
    }
  } else {
    if ((add == null) === (cancel == null)) error('must specify --add or --cancel, but not both')
    const from = commander.from ?? await logic.findWealthyAccount()
    const sendOptions = {
      gasPrice: toWei(commander.gasPrice, 'gwei'),
      gas: 1e6,
      from
    }
    if (version == null) {
      error('--add/--cancel commands require both --id and --ver')
    }
    if (add != null) {
      await versionRegistry.addVersion(id, version, add, sendOptions)
      console.log(`== Added version ${id} @ ${version}`)
    } else {
      const reason = commander.reason ?? ''
      await versionRegistry.cancelVersion(id, version, reason, sendOptions)
      console.log(`== Canceled version ${id} @ ${version}`)
    }
  }
})()
  .then(() => process.exit(0))
  .catch(
    reason => {
      console.error(reason)
      process.exit(1)
    }
  )
