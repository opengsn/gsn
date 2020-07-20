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

gsnCommander(['n', 'f', 'm', 'g'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network (optional; deploys new one by default)')
  .option('-c, --config <mnemonic>', 'config JSON file to change the configuration of the RelayHub being deployed (optional)')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const mnemonic = getMnemonic(commander.mnemonic)
  const relayHubConfiguration = getRelayHubConfiguration(commander.config) ?? defaultEnvironment.relayHubConfiguration
  const logic = new CommandsLogic(nodeURL, configureGSN({}), mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()
  const gasPrice = commander.gasPrice

  const deploymentResult = await logic.deployGsnContracts({
    from,
    gasPrice,
    relayHubConfiguration,
    deployPaymaster: true,
    forwarderAddress: commander.forwarder
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
