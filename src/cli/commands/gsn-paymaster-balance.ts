import commander from 'commander'
import fs from 'fs'
import Web3 from 'web3'
import CommandsLogic from '../CommandsLogic'
import { configureGSN } from '../../relayclient/GSNConfigurator'

commander
  // .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--paymaster <address>', 'address of the paymaster contract')
  // .option('--hub <address>', 'address of the hub contract')
  .parse(process.argv);

(async () => {
  const nodeURL = commander.ethereumNodeURL !== undefined ? commander.ethereumNodeURL : 'http://localhost:8545'

  const relayHubDeployInfo = fs.readFileSync('build/gsn/RelayHub.json').toString()
  const paymasterDeployInfo = fs.readFileSync('build/gsn/Paymaster.json').toString()

  const hub = commander.hub ?? JSON.parse(relayHubDeployInfo).address
  const paymaster: string = commander.paymaster ?? JSON.parse(paymasterDeployInfo).address

  const logic = new CommandsLogic(nodeURL, configureGSN({ relayHubAddress: hub }))
  const balance = await logic.getPaymasterBalance(paymaster)
  console.log(`Account ${paymaster} has a GSN balance of ${Web3.utils.fromWei(balance)} ETH`)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
