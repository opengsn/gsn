import Web3 from 'web3'
import { CommandsLogic } from '../CommandsLogic'
import { getNetworkUrl, getPaymasterAddress, getRelayHubAddress, gsnCommander } from '../utils'
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'

const commander = gsnCommander(['h', 'n'])
  .option('--paymaster <address>', 'address of the paymaster contract')
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

  const logic = new CommandsLogic(nodeURL, logger, { relayHubAddress: hub })
  await logic.init()
  const balance = await logic.getPaymasterBalance(paymaster)
  console.log(`Account ${paymaster} has a GSN balance of ${Web3.utils.fromWei(balance)} ETH`)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
