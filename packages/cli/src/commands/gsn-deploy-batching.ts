import commander from 'commander'
import { toWei } from 'web3-utils'

import {
  getMnemonic,
  getNetworkUrl,
  gsnCommander,
  showBatchingDeployment
} from '../utils'
import { CommandsLogic } from '../CommandsLogic'
import { createCommandsLogger } from '../CommandsWinstonLogger'

gsnCommander(['n', 'f', 'm', 'g'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network')
  .option('--relayHub <address>', 'relayHub')
  .option('--onlyGatewayForwarder', 'only deploys GatewayForwarder', false)
  .option('--onlyTestToken', 'only deploys TestToken', false) // TODO: has nothing to do here, create separate command
  .option('--yes, --skipConfirmation', 'skip con', false)
  .option('-l, --gasLimit <number>', 'gas limit to give to all transactions', '5000000')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()

  const gasPrice = toWei(commander.gasPrice, 'gwei').toString()
  const gasLimit = commander.gasLimit

  const deployOptions = {
    from,
    gasPrice,
    gasLimit,
    verbose: true,
    skipConfirmation: commander.skipConfirmation,
    forwarderAddress: commander.forwarder,
    relayHubAddress: commander.relayHub
  }

  if (commander.onlyGatewayForwarder === true) {
    const gatewayForwarder = await logic.deployGatewayForwarder(deployOptions)
    console.log(`
GatewayForwarder: ${gatewayForwarder}
`)
    process.exit(0)
  }

  if (commander.onlyTestToken === true) {
    const testToken = await logic.deployTestToken(deployOptions)
    console.log(`
TestToken: ${testToken}
`)
    process.exit(0)
  }

  const deploymentResult = await logic.deployBatchingContracts(deployOptions)

  showBatchingDeployment(deploymentResult, `Deployed GSN to network: ${network}`)
  // saveDeployment(deploymentResult, commander.workdir)
  process.exit(0)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
