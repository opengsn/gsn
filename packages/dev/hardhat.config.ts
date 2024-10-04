import '@typechain/hardhat'
import '@nomicfoundation/hardhat-ethers'
import '@nomiclabs/hardhat-truffle5'

module.exports = {
  networks: {
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    }
  },
  solidity:
    {
      version: '0.8.25',
      settings: {
        optimizer: {
          enabled: true,
          runs: 1000
        }
      }
    },
  paths: {
    // note that 'contracts' is a
    sources: './contracts'
  },
  allowUnlimitedContractSize: true
}
