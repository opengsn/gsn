import { CommandsLogic, WithdrawOptions } from '../CommandsLogic'
import { gsnCommander, getKeystorePath, getServerConfig } from '../utils'
import { createCommandsLogger } from '../CommandsWinstonLogger'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { fromWei, toBN } from 'web3-utils'

const commander = gsnCommander(['f', 'g'])
  .option('-k, --keystore-path <keystorePath>', 'relay manager keystore directory', process.cwd() + '/gsndata/manager/')
  .option('-s, --server-config <serverConfig>', 'server config file', process.cwd() + '/config/gsn-relay-config.json')
  .option('-b, --broadcast', 'broadcast tx after logging it to console', false)
  .option('-i, --relayHubId <relayHubId>', 'relayHubId in VersionRegistry contract (if present)', 'hub')
  .requiredOption('-a, --amount <amount>', 'amount of funds to withdraw to owner address, in wei')
  .parse(process.argv);

(async () => {
  const config = getServerConfig(commander.serverConfig)
  const host = config.ethereumNodeUrl
  const logger = createCommandsLogger(commander.loglevel)
  const logic = await new CommandsLogic(host, logger, { versionRegistryAddress: config.versionRegistryAddress }).init()
  const keystorePath = getKeystorePath(commander.keystorePath)
  const keyManager = new KeyManager(1, keystorePath)

  const withdrawOptions: WithdrawOptions = {
    withdrawAmount: toBN(commander.amount),
    keyManager,
    config,
    broadcast: commander.broadcast
  }
  console.log('config is', config)
  config.relayHubId = config.relayHubId ?? commander.relayHubId
  console.log(`withdrawalAmount is ${withdrawOptions.withdrawAmount.toString()} (${fromWei(withdrawOptions.withdrawAmount)}eth)`)
  console.log('broadcast is', withdrawOptions.broadcast)
  const result = await logic.withdrawToOwner(withdrawOptions)
  if (result.success) {
    console.log('Withdrew to owner successfully! Transactions:\n', result.transactions)
    process.exit(0)
  } else {
    console.error('Failed to withdraw to owner:', result.error)
    process.exit(1)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
