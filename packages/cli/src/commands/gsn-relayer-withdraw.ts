import { CommandsLogic, WithdrawOptions } from '../CommandsLogic'
import { getNetworkUrl, gsnCommander, getKeystorePath, getServerConfig } from '../utils'
import { createCommandsLogger } from '../CommandsWinstonLogger'
import os from 'os'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'

const commander = gsnCommander(['n', 'f', 'g'])
  .option('-k, --keystore-path <keystorePath>', 'relay manager keystore directory', os.homedir() + '/gsndata/manager')
  .option('-s, --server-config <serverConfig>', 'server config file', os.homedir() + '/gsndata/config/gsn-relay-config.json')
  .option('-b, --broadcast <broadcast>', 'broadcast tx after logging it to console', true)
  .requiredOption('-a, --amount <amount>', 'amount of funds to withdraw to owner address, in wei')
  .parse(process.argv);

(async () => {
  console.log('current dir is', process.cwd())
  const host = getNetworkUrl(commander.network)
  const logger = createCommandsLogger(commander.loglevel)
  const logic = await new CommandsLogic(host, logger, {}).init()
  const keystorePath = getKeystorePath(commander.keystorePath)
  const keyManager = new KeyManager(1, keystorePath)
  const config = getServerConfig(commander.serverConfig)

  const withdrawOptions: WithdrawOptions = {
    withdrawAmount: parseInt(commander.amount),
    keyManager,
    config,
    broadcast: commander.broadcast
  }

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
