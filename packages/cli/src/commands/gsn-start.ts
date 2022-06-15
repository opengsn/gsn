import commander from 'commander'
import { gsnCommander, saveDeployment, showDeployment } from '../utils'
import { GsnTestEnvironment } from '../GsnTestEnvironment'
import { execSync } from 'child_process'

gsnCommander(['n'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .option('--withNode', 'start with "hardhat node" in the background', false)
  .option('--run <command>', 'run with command after GSN is started. stop GSN when the commands finish')
  .parse(process.argv);

(async () => {
  try {
    const network: string = commander.network
    if (network !== 'localhost' && commander.withNode != null) {
      throw new Error('can\'t have both --network and --withNode')
    }
    const env = await GsnTestEnvironment.startGsn(network, commander.withNode)
    saveDeployment(env.contractsDeployment, commander.workdir)

    if (commander.run != null) {
      console.log('running command: ', commander.run)
      try {
        execSync(commander.run, { stdio: 'inherit' })
        process.exit(0)
      } catch (e: any) {
        process.exit(1)
      }
    } else {
      showDeployment(env.contractsDeployment, 'GSN started')
      console.log(`Relay is active, URL = ${env.relayUrl} . Press Ctrl-C to abort`)
    }
  } catch (e) {
    console.error(e)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
