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
import path from 'path'
import chalk from 'chalk'

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

const infuraUrl = (name: string) => `https://${name}.infura.io/v3/${process.env.INFURA_ID}`

function getInfuraNetwork (name: string): NetworkUserConfig {
  return getNetwork(infuraUrl(name))
}

const CONTRACTS_LINK = 'contracts-link'

if (!fs.existsSync(path.join(CONTRACTS_LINK, 'RelayHub.sol'))) {
  console.log('== creating symlink', chalk.yellow(CONTRACTS_LINK), 'for contracts')
  fs.symlinkSync('../contracts/solpp', CONTRACTS_LINK)
}

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.7',
    settings: {
      optimizer: {
        enabled: true
      }
    }
  },
  paths: {
    sources: CONTRACTS_LINK // can't use "../contracts/src" directly.
  },
  networks: {
    hardhat: { chainId: parseInt(process.env.FORK  ?? '1337' ) },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    },

    dev: getNetwork('http://localhost:8545'),
    rarb: getNetwork('https://rinkeby.arbitrum.io/rpc'),
    aox: getNetwork('https://arbitrum.xdaichain.com/'),

    goerli: getInfuraNetwork('goarli'),
    kovan: getInfuraNetwork('kovan'),
    mainnet: getInfuraNetwork('mainnet')
  },

  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY }
}

// support url-based network: either start with "http", or a single work (infura network name)
const neturl = process.argv.find((val, i, env) => (env[i - 1] === '--network'))
if (neturl != null && config.networks != null && config.networks[neturl] == null) {
  console.log(chalk.yellow('NOTE:'), 'using --network', chalk.yellow(neturl), 'which doesn\'t appear in config file')
  if (neturl.match(/^http/) != null) {
    config.networks[neturl] = getNetwork(neturl)
  } else if (neturl.match(/^[\w-]+$/) != null) {
    config.networks[neturl] = getInfuraNetwork(neturl)
  }
}

module.exports = config
