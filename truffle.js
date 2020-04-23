require('ts-node/register')

var HDWalletProvider = require('truffle-hdwallet-provider')
var mnemonic = 'digital unknown jealous mother legal hedgehog save glory december universe spread figure custom found six'

const packageJson = require('./package.json')
const secretMnemonicFile = './secret_mnemonic'
const fs = require('fs')
let secretMnemonic
if (fs.existsSync(secretMnemonicFile)) {
  secretMnemonic = fs.readFileSync(secretMnemonicFile, { encoding: 'utf8' })
}

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  networks: {

    development: {
      provider: undefined,
      verbose: process.env.VERBOSE,
      host: '127.0.0.1',
      port: 8545,
      network_id: '*'
    },
    coverage: { // coverage/trace provider. note that it currently can't run extrnal-process relay.
      provider: require('./coverage-prov.js'),
      verbose: process.env.VERBOSE,
      network_id: '*'
    },
    npmtest: { // used from "npm test". see pakcage.json
      verbose: process.env.VERBOSE,
      host: '127.0.0.1',
      port: 8544,
      network_id: '*'
    },
    mainnet: {
      provider: function () {
        return new HDWalletProvider(mnemonic, 'https://mainnet.infura.io/v3/c3422181d0594697a38defe7706a1e5b')
      },
      network_id: 1
    },
    ropsten: {
      provider: function () {
        return new HDWalletProvider(mnemonic, 'https://ropsten.infura.io/v3/c3422181d0594697a38defe7706a1e5b')
      },
      network_id: 3
    },
    xdai_poa_mainnet: {
      provider: function () {
        const wallet = new HDWalletProvider(secretMnemonic, 'https://dai.poa.network')
        return wallet
      },
      network_id: 100
    }
  },
  mocha: {
    slow: 1000
  },
  compilers: {
    solc: {
      version: packageJson.devDependencies.solc,
      settings: {
        evmVersion: 'istanbul',
        optimizer: {
          enabled: true,
          runs: 200 // Optimize for how many times you intend to run the code
        }
      }
    }
  }
}
