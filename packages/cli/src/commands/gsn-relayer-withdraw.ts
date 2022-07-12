import { CommandsLogic, WithdrawOptions } from '../CommandsLogic'
import { gsnCommander, getKeystorePath, getServerConfig } from '../utils'
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { fromWei, toWei } from 'web3-utils'
import { ether } from '@opengsn/common'

const commander = gsnCommander(['g'])
  .option('-k, --keystore-path <keystorePath>', 'relay manager keystore directory', process.cwd() + '/gsndata/manager/')
  .option('-s, --server-config <serverConfig>', 'server config file', process.cwd() + '/config/gsn-relay-config.json')
  .option('-b, --broadcast', 'broadcast tx after logging it to console', false)
  .option('-t, --target <address>', 'target address for withdraw (defaults to owner)')
  .option('-a, --eth-account-amount <ethAccountAmount>', 'withdraw from relay manager eth account balance, in eth')
  .option('-d, --hub-balance-amount <hubBalanceAmount>', 'withdraw from relay manager hub balance, in eth')
  .parse(process.argv);

(async () => {
  const config = getServerConfig(commander.serverConfig)
  const host = config.ethereumNodeUrl
  const logger = createCommandsLogger(commander.loglevel)
  const logic = await new CommandsLogic(host, logger, { relayHubAddress: config.relayHubAddress }).init()
  const keystorePath = getKeystorePath(commander.keystorePath)
  const keyManager = new KeyManager(1, keystorePath)

  if (commander.ethAccountAmount == null && commander.hubBalanceAmount == null) {
    await logic.displayManagerBalances(config, keyManager)
    return
  }
  if (commander.ethAccountAmount != null && commander.hubBalanceAmount != null) {
    throw new Error('Must provide exactly one option of -d (--hub-deposit-amount) or -e (--eth-account-amount)')
  }

  const withdrawOptions: WithdrawOptions = {
    withdrawAmount: ether(commander.ethAccountAmount ?? commander.hubBalanceAmount),
    keyManager,
    config,
    broadcast: commander.broadcast,
    withdrawTarget: commander.target,
    gasPrice: commander.gasPrice != null ? toWei(commander.gasPrice, 'gwei') : undefined,
    useAccountBalance: commander.ethAccountAmount != null
  }

  console.log(`Withdrawal amount is ${fromWei(withdrawOptions.withdrawAmount)}eth`)
  console.log('Should broadcast?', withdrawOptions.broadcast)
  console.log('Withdrawing to', withdrawOptions.withdrawTarget ?? '(owner)')
  const result = await logic.withdrawToOwner(withdrawOptions)
  if (result.success) {
    if (withdrawOptions.broadcast) {
      console.log('Withdrew to owner successfully! Transactions:\n', result.transactions)
    } else {
      console.log('Running in view mode succeeded! Run again with --broadcast to send the transaction on-chain')
    }
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
