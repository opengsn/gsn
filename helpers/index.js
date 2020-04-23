const { getRelayHub, isRelayHubDeployed } = require('./src/helpers');
const _ = require('lodash');
const expectError = require('./src/expectError');
const { balance } = require('./src/balance');
const { deployRelayHub } = require('./src/deploy');
const { fundPaymaster } = require('./src/fund');
const { registerRelay } = require('./src/register');
const { relayHub } = require('./src/data');
const { withdraw } = require('./src/withdraw');

module.exports = {
  balance,
  deployRelayHub,
  expectError,
  fundPaymaster,
  getRelayHub,
  isRelayHubDeployed,
  registerRelay,
  relayHub: _.pick(relayHub, ['abi', 'address', 'bytecode']),
  withdraw,
};
