import commander from 'commander'
import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { getNetworkUrl, gsnCommander, saveDeployment, showDeployment } from '../utils'

// TODO: support deploying custom paymasters by passing bytecode, ABI and constructor params
gsnCommander(['n', 'f'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const logic = new CommandsLogic(nodeURL, configureGSN({}))
  const from = commander.from ?? await logic.findWealthyAccount()

  const deploymentResult = await logic.deployGsnContracts(from)
  const paymasterName = 'Default'

  showDeployment(deploymentResult, `Deployed GSN to network: ${network}`, paymasterName)
  saveDeployment(deploymentResult, commander.workdir)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
