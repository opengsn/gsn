const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient.sol')
const TestSponsor = artifacts.require('./test/TestSponsorEverythingAccepted.sol')

const GTXDATANONZERO = 68

module.exports = async function (deployer) {
  await deployer.deploy(RelayHub, GTXDATANONZERO, { gas: 10000000 })
  const testRecipient = await deployer.deploy(TestRecipient)
  const testSponsor = await deployer.deploy(TestSponsor)
  await testRecipient.setHub(RelayHub.address)
  await testSponsor.setHub(RelayHub.address)
}
