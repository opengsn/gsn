import commander from 'commander'
import { gsnCommander, saveDeployment, showDeployment } from '../utils'
import { GsnTestEnvironment } from '../GsnTestEnvironment'

gsnCommander(['n'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .parse(process.argv);

(async () => {
  try {
    const network: string = commander.network
    const env = await GsnTestEnvironment.startGsn(network)
    saveDeployment(env.contractsDeployment, commander.workdir)
    showDeployment(env.contractsDeployment, 'GSN started')

    console.log(`Relay is active, URL = ${env.relayUrl} . Press Ctrl-C to abort`)
  } catch (e) {
    console.error(e)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
