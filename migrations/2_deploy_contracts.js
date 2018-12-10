var RelayHub = artifacts.require("./RelayHub.sol");
var RelayRecepient = artifacts.require("./RelayRecipient.sol");
var SampleRecipient = artifacts.require("./SampleRecipient.sol");
var RLPReader= artifacts.require("./RLPReader.sol");

module.exports = function(deployer) {
	deployer.deploy(RLPReader);
	deployer.link(RLPReader, RelayHub);
	deployer.deploy(RelayHub).then(function() {
		return deployer.deploy(SampleRecipient, RelayHub.address);
	});
	deployer.link(RelayHub, RelayRecepient);
	deployer.deploy(RelayRecepient);
	deployer.link(RelayHub, SampleRecipient);
};
