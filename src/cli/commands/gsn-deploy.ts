import commander from 'commander'
import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import {
  getMnemonic,
  getNetworkUrl,
  getRelayHubConfiguration,
  gsnCommander,
  saveDeployment,
  showDeployment
} from '../utils'
import { defaultEnvironment } from '../../common/Environments'
import { toWei } from 'web3-utils'

gsnCommander(['n', 'f', 'm', 'g'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network (optional; deploys new one by default)')
  .option('--stakeManager <address>', 'stakeManager')
  .option('--relayHub <address>', 'relayHub')
  .option('--penalizer <address>', 'penalizer')
  .option('--registry <address>', 'versionRegistry')
  .option('--registryHubId <string>', 'save the address of the relayHub to the registry, with this hub-id')
  .option('--yes, --skipConfirmation', 'skip con')
  .option('-c, --config <mnemonic>', 'config JSON file to change the configuration of the RelayHub being deployed (optional)')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const mnemonic = getMnemonic(commander.mnemonic)
  const relayHubConfiguration = getRelayHubConfiguration(commander.config) ?? defaultEnvironment.relayHubConfiguration
  const logic = new CommandsLogic(nodeURL, configureGSN({}), mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()

  async function getGasPrice (): Promise<string> {
    const gasPrice = await web3.eth.getGasPrice()
    console.log(`Using network gas price of ${gasPrice}`)
    return gasPrice
  }

  const gasPrice = toWei(commander.gasPrice, 'gwei') ?? await getGasPrice()

  const deploymentResult = await logic.deployGsnContracts({
    from,
    gasPrice: gasPrice.toString(),
    relayHubConfiguration,
    deployPaymaster: true,
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
