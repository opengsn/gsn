#!/usr/bin/env node

import commander from 'commander'
import { gsnRuntimeVersion } from '@opengsn/common'

commander
  .version(gsnRuntimeVersion)
  .command('start', 'all-on-one: deploy all contracts, start relay')
  .command('deploy', 'deploy RelayHub and other GSN contracts instances')
  .command('relayer-register', 'stake for a relayer and fund it')
  .command('relayer-withdraw', 'Withdraw relayer\'s manager balance from RelayHub to owner')
  .command('relayer-run', 'launch a relayer server')
  .command('paymaster-fund', 'fund a paymaster contract so it can pay for relayed calls')
  .command('paymaster-balance', 'query a paymaster GSN balance')
  .command('send-request', 'send a GSN meta-transaction request to a server using a GSN provider')
  .parse(process.argv)
