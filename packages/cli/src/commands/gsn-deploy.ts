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
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'
import { Environment, environments, EnvironmentsKeys } from '@opengsn/common'

gsnCommander(['n', 'f', 'm', 'g', 'l'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--forwarder <address>', 'address of forwarder deployed to the current network (optional; deploys new one by default)')
  .option('--stakeManager <address>', 'stakeManager')
  .option('--relayHub <address>', 'relayHub')
  .option('--penalizer <address>', 'penalizer')
  .option('--relayRegistrar <address>', 'relayRegistrar')
  .option('--environmentName <string>', `name of one of the GSN supported environments: (${Object.keys(EnvironmentsKeys).toString()}; default: ethereumMainnet)`, EnvironmentsKeys.ethereumMainnet)
  .requiredOption('--burnAddress <string>', 'address to transfer burned stake tokens into')
  .requiredOption('--devAddress <string>', 'address to transfer abandoned stake tokens into')
  .option('--stakingToken <string>', 'default staking token to use')
  .option('--minimumTokenStake <number>', 'minimum staking value', '1')
  .option('--yes, --skipConfirmation', 'skip confirmation message for deployment transaction')
  .option('--testToken', 'deploy test weth token', false)
  .option('--testPaymaster', 'deploy test paymaster (accepts everything, avoid on main-nets)', false)
  .option('-c, --config <path>', 'config JSON file to change the configuration of the RelayHub being deployed (optional)')
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
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic, commander.derivationPath, commander.derivationIndex, commander.privateKeyHex)
  const from = commander.from ?? await logic.findWealthyAccount()

  const gasPrice = toHex(commander.gasPrice != null ? toWei(commander.gasPrice, 'gwei').toString() : await logic.getGasPrice())
  const gasLimit = commander.gasLimit

  if (commander.testToken === (commander.stakingToken != null)) {
    throw new Error('must specify either --testToken or --stakingToken')
  }

  const deploymentResult = await logic.deployGsnContracts({
    from,
    gasPrice,
    gasLimit,
    relayHubConfiguration,
    penalizerConfiguration,
    stakingTokenAddress: commander.stakingToken,
    minimumTokenStake: commander.minimumTokenStake,
    deployPaymaster: commander.testPaymaster,
    deployTestToken: commander.testToken,
    verbose: true,
    skipConfirmation: commander.skipConfirmation,
    forwarderAddress: commander.forwarder,
    stakeManagerAddress: commander.stakeManager,
    relayHubAddress: commander.relayHub,
    penalizerAddress: commander.penalizer,
    relayRegistryAddress: commander.relayRegistrar,
    burnAddress: commander.burnAddress,
    devAddress: commander.devAddress
  })
  const paymasterName = 'Default'

  showDeployment(deploymentResult, `Deployed GSN to network: ${network}`, console, paymasterName)
  saveDeployment(deploymentResult, commander.workdir)
  process.exit(0)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
