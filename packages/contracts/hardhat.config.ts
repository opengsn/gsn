import '@typechain/hardhat'
import '@nomicfoundation/hardhat-ethers'

module.exports = {
  solidity: '0.8.25',
  paths: {
    // CLI package needs to deploy contracts from JSON artifacts
    // contracts_build_directory: '../cli/src/compiled',
    sources: './src'
  }
}
