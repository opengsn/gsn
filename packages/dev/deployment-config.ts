// each "Environment" entry in this Partial<Environment>
module.exports = {
  1337: {
    relayHubConfiguration: {},
    // deploymentConfiguration is the only entry not read from the "environments"
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      minimumStakePerToken: {
        test: '0.1',
        '0x610178dA211FEF7D417bC0e6FeD39F05609AD788': '0.3'
      }
    }
  },
  5: {
    relayHubConfiguration: {
      devAddress: '0xd21934eD8eAf27a67f0A70042Af50A1D6d195E81'
    },
    maxUnstakeDelay: 100000000,
    abandonmentDelay: 10000,
    escheatmentDelay: 500,
    nonZeroDevFeeGasOverhead: 5596,
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      deployTestPaymaster: true,
      minimumStakePerToken: { test: '0.5' }
    }
  },

  80001: {
    relayHubConfiguration: {
      devAddress: '0xd21934eD8eAf27a67f0A70042Af50A1D6d195E81'
    },
    maxUnstakeDelay: 100000000,
    abandonmentDelay: 10000,
    escheatmentDelay: 500,
    nonZeroDevFeeGasOverhead: 5596,
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      deployTestPaymaster: true,
      minimumStakePerToken: { test: '0.5' }
    }
  },

  69: {
    relayHubConfiguration: {
      devAddress: '0xd21934eD8eAf27a67f0A70042Af50A1D6d195E81'
    },
    maxUnstakeDelay: 100000000,
    abandonmentDelay: 10000,
    escheatmentDelay: 500,
    nonZeroDevFeeGasOverhead: 5596,
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      deployTestPaymaster: true,
      minimumStakePerToken: { test: '0.5' }
    }
  },

  43113: {
    relayHubConfiguration: {
      devAddress: '0xd21934eD8eAf27a67f0A70042Af50A1D6d195E81'
    },
    maxUnstakeDelay: 100000000,
    abandonmentDelay: 10000,
    escheatmentDelay: 500,
    nonZeroDevFeeGasOverhead: 5596,
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      deployTestPaymaster: true,
      minimumStakePerToken: { test: '0.1' }
    }
  }
}
