#!/usr/bin/env node

const program = require('commander')

program
  .version(require('../package.json').version)
  .command('deploy-relay-hub', 'deploy the singleton RelayHub instance')
  .command('register-relayer', 'stake for a relayer and fund it')
  .command('fund-paymaster', 'fund a paymaster contract so that it can receive relayed calls')
  .command('balance', 'query a paymaster or relayer owner GSN balance')
  .command('withdraw', 'withdraw a relayer\'s owner revenue')
  .parse(process.argv)
