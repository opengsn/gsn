var RelayHub = artifacts.require("./RelayHub.sol");
var RelayRecipient = artifacts.require("./RelayRecipient.sol");
var SampleRecipient = artifacts.require("./SampleRecipient.sol");
var RLPReader= artifacts.require("./RLPReader.sol");

module.exports = function(deployer) {
	deployer.deploy(RelayHub).then(function() {
		return deployer.deploy(SampleRecipient, RelayHub.address);
	});
};
