var RelayHub = artifacts.require('./RelayHub.sol')
var SampleRecipient = artifacts.require('./TestRecipient.sol')

module.exports = async function (deployer) {
  await deployer.deploy(RelayHub, { gas: 8000000 })
  const sr = await deployer.deploy(SampleRecipient)
  await sr.setHub(RelayHub.address)
}
