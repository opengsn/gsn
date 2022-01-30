require('ts-node/register/transpile-only')

module.exports = {
  // CLI package needs to deploy contracts from JSON artifacts
  contracts_build_directory: '../cli/src/compiled',
  contracts_directory: './solpp',
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
