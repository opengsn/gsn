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
import { toHex, toWei } from 'web3-utils'
import { createCommandsLogger } from '../CommandsWinstonLogger'
import { constants, Environment, environments, EnvironmentsKeys } from '@opengsn/common'

gsnCommander(['n', 'f', 'm', 'g', 'l'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network (optional; deploys new one by default)')
  .option('--stakeManager <address>', 'stakeManager')
  .option('--relayHub <address>', 'relayHub')
  .option('--penalizer <address>', 'penalizer')
  .option('--relayRegistrar <address>', 'relayRegistrar')
  .option('--environmentName <string>', `name of one of the GSN supported environments: (${Object.keys(EnvironmentsKeys).toString()}; default: ethereumMainnet)`, EnvironmentsKeys.ethereumMainnet)
  .option('--burnAddress <string>', 'address to transfer burned stake tokens into', constants.BURN_ADDRESS)
  .option('--yes, --skipConfirmation', 'skip con')
  .option('--testPaymaster', 'deploy test paymaster (accepts everything, avoid on main-nets)', false)
  .option('--testToken', 'deploy test token (public mint function)', false)
  .option('-c, --config <mnemonic>', 'config JSON file to change the configuration of the RelayHub being deployed (optional)')
  .parse(process.argv);

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)
  const environment: Environment = environments[commander.environmentName as EnvironmentsKeys]
  if (environment == null) {
    throw new Error(`Unknown named environment: ${commander.environmentName as string}`)
  }
  console.log('Using environment: ', JSON.stringify(environment))

  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const relayHubConfiguration = getRelayHubConfiguration(commander.config) ?? environment.relayHubConfiguration
  const penalizerConfiguration = environment.penalizerConfiguration
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()

  const gasPrice = toHex(commander.gasPrice != null ? toWei(commander.gasPrice, 'gwei').toString() : await logic.getGasPrice())
  const gasLimit = commander.gasLimit

  const deploymentResult = await logic.deployGsnContracts({
    from,
    gasPrice,
    gasLimit,
    relayHubConfiguration,
    penalizerConfiguration,
    deployTestToken: commander.testToken,
    deployPaymaster: commander.testPaymaster,
    verbose: true,
    skipConfirmation: commander.skipConfirmation,
    forwarderAddress: commander.forwarder,
    stakeManagerAddress: commander.stakeManager,
    relayHubAddress: commander.relayHub,
    penalizerAddress: commander.penalizer,
    relayRegistryAddress: commander.relayRegistrar,
    burnAddress: commander.burnAddress
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
