require('ts-node/register/transpile-only')

module.exports = {
  // CLI package needs to deploy contracts from JSON artifacts
  contracts_build_directory: '../cli/src/compiled',
  contracts_directory: './src',
  compilers: {
    solc: {
      version: '0.8.7-nightly.2021.8.9+commit.74c804d8',
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
