import commander from 'commander'
import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { getNetworkUrl, gsnCommander } from '../utils'

// TODO: support deploying custom paymasters by passing bytecode, ABI and constructor params
gsnCommander(['n', 'f'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)

  const logic = new CommandsLogic(nodeURL, configureGSN({}))
  const from = commander.from ?? await logic.findWealthyAccount()

  const deploymentResult = await logic.deployRelayHub(from)
  const paymasterName = 'Default'

  console.log(
    `Deployed GSN to network: ${network}
  RelayHub: ${deploymentResult.relayHubAddress}
  StakeManager: ${deploymentResult.stakeManagerAddress}
  Penalizer: ${deploymentResult.penalizerAddress}
  TrustedForwarder: ${deploymentResult.forwarderAddress}
  Paymaster (${paymasterName}): ${deploymentResult.paymasterAddress}
  `)

  logic.saveContractToFile(deploymentResult.stakeManagerAddress, commander.workdir, 'StakeManager.json')
  logic.saveContractToFile(deploymentResult.penalizerAddress, commander.workdir, 'Penalizer.json')
  logic.saveContractToFile(deploymentResult.relayHubAddress, commander.workdir, 'RelayHub.json')
  logic.saveContractToFile(deploymentResult.paymasterAddress, commander.workdir, 'Paymaster.json')
  logic.saveContractToFile(deploymentResult.forwarderAddress, commander.workdir, 'Forwarder.json')
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
