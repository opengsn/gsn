import commander from 'commander'
import { CommandsLogic } from '../CommandsLogic'
import {
  getMnemonic,
  getNetworkUrl,
  getRelayHubConfiguration,
  gsnCommander,
  saveDeployment,
  showDeployment
} from '../utils'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { toWei } from 'web3-utils'
import { createCommandsLogger } from '../CommandsWinstonLogger'

gsnCommander(['n', 'f', 'm', 'g'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network (optional; deploys new one by default)')
  .option('--stakeManager <address>', 'stakeManager')
  .option('--relayHub <address>', 'relayHub')
  .option('--penalizer <address>', 'penalizer')
  .option('--registry <address>', 'versionRegistry')
  .option('--registryHubId <string>', 'save the address of the relayHub to the registry, with this hub-id')
  .option('--yes, --skipConfirmation', 'skip con')
  .option('--testPaymaster', 'deploy test paymaster (accepts everything, avoid on main-nets)', false)
  .option('-c, --config <mnemonic>', 'config JSON file to change the configuration of the RelayHub being deployed (optional)')
  .option('-l, --gasLimit <number>', 'gas limit to give to all transactions', '5000000')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const relayHubConfiguration = getRelayHubConfiguration(commander.config) ?? defaultEnvironment.relayHubConfiguration
  const penalizerConfiguration = defaultEnvironment.penalizerConfiguration
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()

  async function getGasPrice (): Promise<string> {
    const gasPrice = await web3.eth.getGasPrice()
    console.log(`Using network gas price of ${gasPrice}`)
    return gasPrice
  }

  const gasPrice = toWei(commander.gasPrice, 'gwei').toString() ?? await getGasPrice()
  const gasLimit = parseInt(commander.gasLimit)

  const deploymentResult = await logic.deployGsnContracts({
    from,
    gasPrice,
    gasLimit,
    relayHubConfiguration,
    penalizerConfiguration,
    deployPaymaster: commander.testPaymaster,
    verbose: true,
    skipConfirmation: commander.skipConfirmation,
    forwarderAddress: commander.forwarder,
    stakeManagerAddress: commander.stakeManager,
    relayHubAddress: commander.relayHub,
    penalizerAddress: commander.penalizer,
    registryAddress: commander.registry,
    registryHubId: commander.registryHubId
  })
  const paymasterName = 'Default'

  showDeployment(deploymentResult, `Deployed GSN to network: ${network}`, paymasterName)
  saveDeployment(deploymentResult, commander.workdir)
  process.exit(0)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
