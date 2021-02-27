const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const SampleRecipient = artifacts.require('TestRecipient')
const Forwarder = artifacts.require('Forwarder')

module.exports = async function (deployer) {
  await deployer.deploy(StakeManager, 30000)
  await deployer.deploy(Penalizer, 0, 0)
  await deployer.deploy(RelayHub, StakeManager.address, Penalizer.address, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  await deployer.deploy(Forwarder)
  await deployer.deploy(SampleRecipient, Forwarder.address)
}
