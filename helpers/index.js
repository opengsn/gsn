const { getRelayHub, isRelayHubDeployed } = require('./src/helpers');
const _ = require('lodash');
const expectError = require('./src/expectError');
const { balance } = require('./src/balance');
const { deployRelayHub } = require('./src/deploy');
const { downloadRelayer } = require('./src/download');
const { fundPaymaster } = require('./src/fund');
const { registerRelay } = require('./src/register');
const { relayHub } = require('./src/data');
const { runRelayer, runAndRegister } = require('./src/run');
const { withdraw } = require('./src/withdraw');

module.exports = {
  balance,
  deployRelayHub,
  downloadRelayer,
  expectError,
  fundPaymaster,
  getRelayHub,
  isRelayHubDeployed,
  registerRelay,
  relayHub: _.pick(relayHub, ['abi', 'address', 'bytecode']),
  runAndRegister,
  runRelayer,
  withdraw,
};
