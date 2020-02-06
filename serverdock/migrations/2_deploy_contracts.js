var RelayHub = artifacts.require('./RelayHub.sol')
var RelayRecipient = artifacts.require('./BaseRelayRecipient.sol')
var SampleRecipient = artifacts.require('./TestRecipient.sol')
var RLPReader = artifacts.require('./RLPReader.sol')

module.exports = function (deployer) {
  deployer.deploy(RLPReader)
  deployer.link(RLPReader, RelayHub)
  deployer.deploy(RelayHub).then(function () {
    return deployer.deploy(SampleRecipient, RelayHub.address)
  })
  deployer.link(RelayHub, RelayRecipient)
  deployer.link(RelayHub, SampleRecipient)
}
