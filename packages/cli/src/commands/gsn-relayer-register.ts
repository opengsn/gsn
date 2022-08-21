import { ether } from '@opengsn/common'

import { CommandsLogic, RegisterOptions } from '../CommandsLogic'
import { getNetworkUrl, gsnCommander, getMnemonic } from '../utils'
import { toWei } from 'web3-utils'
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'

const commander = gsnCommander(['n', 'f', 'm', 'g'])
  .option('--relayUrl <url>', 'url to advertise the relayer', 'http://localhost:8090')
  .option('--stake <stake>', 'amount to stake for the relayer, in ETH', '1')
  .option(
    '--unstakeDelay <delay>',
    'seconds to wait between unregistering and withdrawing the stake', '15000'
  )
  .option(
    '--funds <funds>',
    'amount to transfer to the relayer to pay for relayed transactions, in ETH', '2'
  )
  .option(
    '--sleep <sleep>',
    'ms to sleep each time if waiting for RelayServer to set its owner', '10000'
  )
  .option(
    '--sleepCount <sleepCount>',
    'number of times to sleep before timeout', '5'
  )
  .option('-t, --token <address>', 'Token to be used as a stake, defaults to first registered token')
  .option('--wrap', 'Assume token is "Wrapped ETH". If its balance is not enough for stake, then deposit ETH into it.')
  .parse(process.argv);

(async () => {
  const host = getNetworkUrl(commander.network)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logger = createCommandsLogger(commander.loglevel)
  const logic = await new CommandsLogic(host, logger, {
    managerStakeTokenAddress: commander.token
  }, mnemonic, commander.derivationPath, commander.derivationIndex, commander.privateKeyHex).init()
  const registerOptions: RegisterOptions = {
    sleepMs: parseInt(commander.sleep),
    sleepCount: parseInt(commander.sleepCount),
    from: commander.from ?? await logic.findWealthyAccount(),
    token: commander.token,
    stake: commander.stake,
    wrap: commander.wrap,
    funds: ether(commander.funds),
    gasPrice: commander.gasPrice != null ? toWei(commander.gasPrice, 'gwei') : undefined,
    relayUrl: commander.relayUrl,
    unstakeDelay: commander.unstakeDelay
  }
  if (registerOptions.from == null) {
    console.error('Failed to find a wealthy "from" address')
    process.exit(1)
  }

  const result = await logic.registerRelay(registerOptions)
  if (result.success) {
    console.log('Relay registered successfully! Transactions:\n', result.transactions)
    process.exit(0)
  } else {
    console.error('Failed to register relay:', result.error, result)
    process.exit(1)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
