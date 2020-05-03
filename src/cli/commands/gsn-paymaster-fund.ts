import { ether } from '@openzeppelin/test-helpers'
import program from 'commander'
import fs from 'fs'

import CommandsLogic from '../CommandsLogic'
import { Address } from '../../relayclient/types/Aliases'
import { configureGSN } from '../../relayclient/GSNConfigurator'
import { gsnCommander } from '../utils'

gsnCommander(['n', 'f', 'h'])
  .option('--paymaster <address>',
    'address of the paymaster contract (defaults to address from build/gsn/Paymaster.json if exists')
  .option('--amount <amount>', 'amount of funds to deposit for the paymaster contract, in wei (defaults to 1 Ether)')
  .parse(process.argv);

(async () => {
  const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'

  const relayHubDeployInfo = fs.readFileSync('build/gsn/RelayHub.json').toString()
  const paymasterDeployInfo = fs.readFileSync('build/gsn/Paymaster.json').toString()

  const hub: Address = program.hub ?? JSON.parse(relayHubDeployInfo).address
  const paymaster: Address = program.paymaster ?? JSON.parse(paymasterDeployInfo).address

  const logic = new CommandsLogic(nodeURL, configureGSN({ relayHubAddress: hub }))
  const from = program.from ?? await logic.findWealthyAccount()
  const amount = program.amount ?? ether('1')

  const balance = await logic.fundPaymaster(from, paymaster, amount)
  console.log(`Paymaster ${paymaster} balance is now ${balance.toString()} wei`)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
