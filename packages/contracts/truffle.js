require('ts-node/register/transpile-only')

module.exports = {
  contracts_directory: './src',
  compilers: {
    solc: {
      version: '0.7.6',
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
