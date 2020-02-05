const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient.sol')
const TestSponsor = artifacts.require('./test/TestSponsorEverythingAccepted.sol')

module.exports = async function (deployer) {
  await deployer.deploy(RelayHub, { gas: 8000000 })
  const testRecipient = await deployer.deploy(TestRecipient)
  const testSponsor = await deployer.deploy(TestSponsor)
  await testRecipient.setHub(RelayHub.address)
  await testSponsor.setHub(RelayHub.address)
}
