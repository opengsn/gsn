/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import '@nomiclabs/hardhat-truffle5'
import '@nomiclabs/hardhat-web3'
import 'hardhat-deploy'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'

import fs from 'fs'
import { HardhatUserConfig } from 'hardhat/config'
import { NetworkUserConfig } from 'hardhat/src/types/config'

const mnemonicFileName = process.env.MNEMONIC_FILE
let mnemonic = 'test '.repeat(11) + 'junk'
if (mnemonicFileName != null && fs.existsSync(mnemonicFileName)) {
  mnemonic = fs.readFileSync(mnemonicFileName, 'ascii')
}

function getNetwork (url: string): NetworkUserConfig {
  return {
    url,
    accounts: { mnemonic }
  }
}

function infuraNetwork (name: string): NetworkUserConfig {
  return getNetwork(`https://${name}.infura.io/v3/${process.env.INFURA_ID}`)
}

const config: HardhatUserConfig = {
  solidity: '0.8.7',
  paths: {
    sources: './contracts-src'
  },
  networks: {
    hardhat: { chainId: 1337 },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    },

    'http://localhost:8545': { url: 'http://localhost:8545' },

    dev: getNetwork('http://localhost:8545'),
    rarb: getNetwork('https://rinkeby.arbitrum.io/rpc'),
    goerli: infuraNetwork('goarli'),
    kovan: infuraNetwork('kovan')
  },
  namedAccounts: {
    deployer: 0
  },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY }
}

// support url-based network: either start with "http", or a single work (infura network name)
const neturl = process.argv.find((val, i, env) => (env[i - 1] === '--network'))
if (neturl != null && config.networks != null && config.networks[neturl] == null) {
  if (neturl.match(/^http/) != null) {
    config.networks[neturl] = getNetwork(neturl)
  } else if (neturl.match(/^[\w-]+$/) != null) {
    config.networks[neturl] = infuraNetwork(neturl)
  }
}

module.exports = config
