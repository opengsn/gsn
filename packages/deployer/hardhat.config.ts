/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import '@nomiclabs/hardhat-web3'
import 'hardhat-deploy'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'

import fs from 'fs'
import { HardhatUserConfig } from 'hardhat/config'
import { NetworkUserConfig } from 'hardhat/src/types/config'
import path from 'path'
import chalk from 'chalk'
import './src/exportTask'

const mnemonicFileName = process.env.MNEMONIC_FILE
let mnemonic = 'test '.repeat(11) + 'junk'
if (mnemonicFileName != null && fs.existsSync(mnemonicFileName)) {
  mnemonic = fs.readFileSync(mnemonicFileName, 'ascii')
}

function getNetwork (url: string): NetworkUserConfig {
  // if "FORK" is set, then "hardhat node --fork" should be active for this chainId
  if (process.env.FORK != null) {
    return {
      url: 'http://localhost:8545',
      chainId: parseInt(process.env.FORK)
    }
  }
  return {
    url,
    accounts: { mnemonic }
  }
}

const infuraUrl = (name: string): string => `https://${name}.infura.io/v3/${process.env.INFURA_ID}`

function getInfuraNetwork (name: string): NetworkUserConfig {
  return getNetwork(infuraUrl(name))
}

const CONTRACTS_LINK = 'contracts-link'

if (!fs.existsSync(path.join(CONTRACTS_LINK, 'RelayHub.sol'))) {
  console.log('== creating symlink', chalk.yellow(CONTRACTS_LINK), 'for contracts')
  fs.symlinkSync('../contracts/solpp', CONTRACTS_LINK)
}
if (!fs.existsSync(path.join(CONTRACTS_LINK, 'paymasters/SingleRecipientPaymaster.sol'))) {
  console.log('== creating symlink', chalk.yellow(CONTRACTS_LINK + '/paymasters'), 'for contracts')
  fs.symlinkSync('../../paymasters/contracts', CONTRACTS_LINK + '/paymasters')
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
    deployments: 'deployments/networks',
    sources: CONTRACTS_LINK // can't use "../contracts/src" directly.
  },
  networks: {
    hardhat: {
      chainId: parseInt(process.env.FORK ?? '1337'),
      saveDeployments: false
    },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544',
      saveDeployments: false
    },

    dev: getNetwork('http://localhost:8545'),
    bsctestnet: getNetwork('https://bsc-testnet.public.blastapi.io'),
    rarb: getNetwork('https://rinkeby.arbitrum.io/rpc'),
    garb: getNetwork('https://goerli-rollup.arbitrum.io/rpc'),
    arbitrum: getNetwork('https://arb1.arbitrum.io/rpc'),
    aox: getNetwork('https://arbitrum.xdaichain.com/'),
    gnosis: getNetwork('https://rpc.gnosis.gateway.fm'),

    goerli: getInfuraNetwork('goerli'),
    ropsten: getInfuraNetwork('ropsten'),
    kovan: getInfuraNetwork('kovan'),
    fuji: getNetwork('https://api.avax-test.network/ext/bc/C/rpc'),
    mumbai: getNetwork('https://rpc-mumbai.maticvigil.com'),
    gopt: getNetwork('https://goerli.optimism.io/'),
    optimism: getNetwork('https://rpc.ankr.com/optimism'),
    polygon: {
      ...getNetwork('https://rpc-mainnet.maticvigil.com'),
      gasPrice: 137577028731
    },
    mainnet: getInfuraNetwork('mainnet')
  },

  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY }
}

module.exports = config
