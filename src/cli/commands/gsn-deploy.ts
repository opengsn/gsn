import commander from 'commander'
import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { getMnemonic, getNetworkUrl, gsnCommander, saveDeployment, showDeployment } from '../utils'

gsnCommander(['n', 'f', 'm'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network (optional; deploys new one by default)')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, configureGSN({}), mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()

  const deploymentResult = await logic.deployGsnContracts({
    from,
    deployPaymaster: true,
    forwarderAddress: commander.forwarder
  })
  const paymasterName = 'Default'

  showDeployment(deploymentResult, `Deployed GSN to network: ${network}`, paymasterName)
  saveDeployment(deploymentResult, commander.workdir)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
