#!/usr/bin/env node

import commander from 'commander'

commander
  .version('0.0.1')
  .command('deploy', 'deploy RelayHub and other GSN contracts instances')
  .command('relayer-register', 'stake for a relayer and fund it')
  .command('relayer-run', 'launch a relayer server')
  .command('paymaster-fund', 'fund a paymaster contract so it can pay for relayed calls')
  .command('paymaster-balance', 'query a paymaster GSN balance')
  .command('status', 'status of the GSN network')
  .parse(process.argv)
