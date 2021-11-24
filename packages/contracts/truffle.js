require('ts-node/register/transpile-only')
const { copyContractsRemoveConsole } = require('./testCopyContracts')
const path = require('path')

module.exports = {
  // CLI package needs to deploy contracts from JSON artifacts
  contracts_build_directory: '../cli/src/compiled',
  contracts_directory: copyContractsRemoveConsole(
    path.resolve(__dirname, './src'),
    path.resolve(__dirname, 'build/src')),
  compilers: {
    solc: {
      version: '0.8.7',
      settings: {
        evmVersion: 'london',
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
}
