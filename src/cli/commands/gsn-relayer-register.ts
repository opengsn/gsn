import { ether } from '@openzeppelin/test-helpers'

import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { getNetworkUrl, getRelayHubAddress, gsnCommander } from '../utils'

const commander = gsnCommander(['n', 'f', 'h'])
  .option('--relayUrl <url>', 'url to advertise the relayer (defaults to localhost:8090)')
  .option('--stake <stake>', 'amount to stake for the relayer, in wei (defaults to 1 Ether)')
  .option(
    '--unstakeDelay <delay>',
    'blocks to wait between unregistering and withdrawing the stake (defaults to one 1000)'
  )
  .option(
    '--funds <funds>',
    'amount to transfer to the relayer to pay for relayed transactions, in wei (defaults to 5 Ether)'
  )
  .parse(process.argv);

(async () => {
  const host = getNetworkUrl(commander.network)
  const hub = getRelayHubAddress(commander.hub)
  const logic = new CommandsLogic(host, configureGSN({ relayHubAddress: hub }))
  const registerOptions = {
    hub,
    from: commander.from ?? await logic.findWealthyAccount(),
    stake: commander.stake ?? ether('1'),
    funds: commander.funds ?? ether('2'),
    relayUrl: commander.relayUrl ?? 'http://localhost:8090',
    unstakeDelay: commander.unstakeDelay ?? 1000
  }
  const result = await logic.registerRelay(registerOptions)
  if (result.success) {
    console.log('Relay registered successfully! Transactions:\n', result.transactions)
  } else {
    console.error('Failed to register relay:', result.error)
    process.exit(1)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
