const Environments = require('../src/js/relayclient/Environments')

const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')

module.exports = async function (deployer) {
  await deployer.deploy(RelayHub, Environments.default.gtxdatanonzero, { gas: 10000000 })
  const testRecipient = await deployer.deploy(TestRecipient)
  const testPaymaster = await deployer.deploy(TestPaymasterEverythingAccepted)
  await testRecipient.setHub(RelayHub.address)
  await testPaymaster.setHub(RelayHub.address)
}
