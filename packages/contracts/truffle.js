require('ts-node/register/transpile-only')
const { copyContractsRemoveConsole } = require('./testCopyContracts')
const path = require('path')

module.exports = {
  // CLI package needs to deploy contracts from JSON artifacts
  contracts_build_directory:
  copyContractsRemoveConsole(
    path.resolve(__dirname, '../cli/src/compiled'),
    path.resolve(__dirname, 'build/src')),
  contracts_directory: './src',
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
