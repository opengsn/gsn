import commander from 'commander'
import { gsnCommander, saveDeployment, showDeployment } from '../utils'
import { GsnTestEnvironment } from '../GsnTestEnvironment'
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'

gsnCommander(['n'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--relayUrl <url>', 'url to advertise the relayer', 'http://127.0.0.1/')
  .option('--port <number>', 'a port for the relayer to listen on. By default, relay will find random available port')
  .parse(process.argv);

(async () => {
  const logger = createCommandsLogger(commander.loglevel)
  const network: string = commander.network
  const localRelayUrl: string = commander.relayUrl
  let port: number | undefined
  if (commander.port != null) {
    port = parseInt(commander.port)
    if (isNaN(port)) {
      throw new Error('port is NaN')
    }
  }
  const env = await GsnTestEnvironment.startGsn(network, localRelayUrl, port, logger)
  saveDeployment(env.contractsDeployment, commander.workdir)
  showDeployment(env.contractsDeployment, 'GSN started', logger, undefined)

  logger.info(`Relay is active, URL = ${env.relayUrl} . Press Ctrl-C to abort`)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
