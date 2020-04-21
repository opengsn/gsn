var RelayHub = artifacts.require('./RelayHub.sol')
var RLPReader = artifacts.require('./RLPReader.sol')
var StakeManager = artifacts.require('./StakeManager.sol')
var Penalizer = artifacts.require('./Penalizer.sol')
var SampleRecipient = artifacts.require('./test/TestRecipient.sol')

module.exports = function (deployer) {
  deployer.deploy(RLPReader)
  deployer.link(RLPReader, RelayHub)
  deployer.deploy(RelayHub, 16, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000')
  deployer.deploy(StakeManager)
  deployer.deploy(Penalizer)
  deployer.deploy(SampleRecipient)
}
