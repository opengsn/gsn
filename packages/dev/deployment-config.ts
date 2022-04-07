// each "Environment" entry in this Partial<Environment>
module.exports = {
  1337: {
    relayHubConfiguration: {},
    // deploymentConfiguration is the only entry not read from the "environments"
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      minimumStakePerToken: { test: '0.5' }
    }
  }
}
