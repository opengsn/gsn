var RelayHub = artifacts.require('./RelayHub.sol')
var StakeManager = artifacts.require('./StakeManager.sol')
var Penalizer = artifacts.require('./Penalizer.sol')
var SampleRecipient = artifacts.require('./test/TestRecipient.sol')
var Eip712Forwarder = artifacts.require('Eip712Forwarder')

module.exports = async function (deployer) {
  await deployer.deploy(StakeManager)
  await deployer.deploy(Penalizer)
  await deployer.deploy(RelayHub, StakeManager.address, Penalizer.address)
  await deployer.deploy(Eip712Forwarder)
  await deployer.deploy(SampleRecipient, Eip712Forwarder.address)
}
