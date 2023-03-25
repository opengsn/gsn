require('ts-node/register/transpile-only')

const HDWalletProvider = require('@truffle/hdwallet-provider')

let mnemonic = 'digital unknown jealous mother legal hedgehog save glory december universe spread figure custom found six'

if (process.env.MNEMONIC_FILE) {
  console.error(`== reading mnemonic file: ${process.env.MNEMONIC_FILE}`)
  mnemonic = require('fs').readFileSync(process.env.MNEMONIC_FILE, 'utf-8').replace(/(\r\n|\n|\r)/gm, '')
}

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
    },
    goerli: {
      provider: function () {
        return new HDWalletProvider(mnemonic, 'https://goerli.infura.io/v3/f40be2b1a3914db682491dc62a19ad43')
      },
      network_id: 5
    }
  },
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
