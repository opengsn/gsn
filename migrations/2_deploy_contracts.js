var RelayHub = artifacts.require("./RelayHub.sol");
var RelayRecipient = artifacts.require("./RelayRecipient.sol");
var SampleRecipient = artifacts.require("./SampleRecipient.sol");
var RLPReader= artifacts.require("./RLPReader.sol");

module.exports = function(deployer) {
	deployer.deploy(RLPReader);
	deployer.link(RLPReader, RelayHub);
	//the gas below is required: it is replaced by "npm run coverage" with value of 1e8, which is required by
	// the instrumented code.
	deployer.deploy(RelayHub, {gas: 7000000}).then(function() {
		return deployer.deploy(SampleRecipient, RelayHub.address);
	});
	deployer.link(RelayHub, RelayRecipient);
	deployer.link(RelayHub, SampleRecipient);
};
