require('ts-node/register/transpile-only')

module.exports = {
  networks: {
    development: {
      verbose: process.env.VERBOSE,
      host: '127.0.0.1',
      port: 8545,
      network_id: '*'
    },
    npmtest: { // used from "npm test". see package.json
      verbose: process.env.VERBOSE,
      host: '127.0.0.1',
      port: 8544,
      network_id: '*'
    }
  },
  compilers: {
    solc: {
      version: '0.8.7',
      settings: {
        evmVersion: 'istanbul',
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
}
