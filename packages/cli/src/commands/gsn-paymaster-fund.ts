import { ether } from '@opengsn/common/dist/Utils'
import { CommandsLogic } from '../CommandsLogic'
import { getMnemonic, getNetworkUrl, getPaymasterAddress, getRelayHubAddress, gsnCommander } from '../utils'
import { createCommandsLogger } from '../CommandsWinstonLogger'

const commander = gsnCommander(['n', 'f', 'h', 'm'])
  .option('--paymaster <address>',
    'address of the paymaster contract (defaults to address from build/gsn/Paymaster.json if exists')
  .option('--amount <amount>', 'amount of funds to deposit for the paymaster contract, in wei (defaults to 1 Ether)')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const hub = getRelayHubAddress(commander.hub)
  const paymaster = getPaymasterAddress(commander.paymaster)

  if (hub == null || paymaster == null) {
    throw new Error(`Contracts not found: hub: ${hub} paymaster: ${paymaster} `)
  }

  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, logger, { relayHubAddress: hub }, mnemonic)
  await logic.init()
  const from = commander.from ?? await logic.findWealthyAccount()
  const amount = commander.amount ?? ether('1')

  const balance = await logic.fundPaymaster(from, paymaster, amount)
  console.log(`Paymaster ${paymaster} balance is now ${balance.toString()} wei`)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
