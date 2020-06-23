var RelayHub = artifacts.require('./RelayHub.sol')
var StakeManager = artifacts.require('./StakeManager.sol')
var Penalizer = artifacts.require('./Penalizer.sol')
var SampleRecipient = artifacts.require('./test/TestRecipient.sol')
var Forwarder = artifacts.require('Forwarder')

module.exports = async function (deployer) {
  await deployer.deploy(StakeManager)
  await deployer.deploy(Penalizer)
  await deployer.deploy(RelayHub, StakeManager.address, Penalizer.address)
  await deployer.deploy(Forwarder)
  await deployer.deploy(SampleRecipient, Forwarder.address)
}
