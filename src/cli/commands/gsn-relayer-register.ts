import { ether } from '../../common/Utils'

import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { getNetworkUrl, gsnCommander, getMnemonic } from '../utils'
import { toWei } from 'web3-utils'
import { createLogger } from '../CommandsWinstonLogger'

const commander = gsnCommander(['n', 'f', 'm', 'g'])
  .option('--relayUrl <url>', 'url to advertise the relayer', 'http://localhost:8090')
  .option('--stake <stake>', 'amount to stake for the relayer, in ETH', '1')
  .option(
    '--unstakeDelay <delay>',
    'blocks to wait between unregistering and withdrawing the stake', '1000'
  )
  .option(
    '--funds <funds>',
    'amount to transfer to the relayer to pay for relayed transactions, in ETH', '2'
  )
  .parse(process.argv);

(async () => {
  const host = getNetworkUrl(commander.network)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logger = createLogger('debug')
  const logic = new CommandsLogic(host, logger, configureGSN({}), mnemonic)
  const registerOptions = {
    from: commander.from ?? await logic.findWealthyAccount(),
    stake: ether(commander.stake),
    funds: ether(commander.funds),
    gasPrice: toWei(commander.gasPrice, 'gwei'),
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
    console.error('Failed to register relay:', result.error)
    process.exit(1)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
