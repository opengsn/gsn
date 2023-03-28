import '@nomiclabs/hardhat-web3'
import 'hardhat-deploy'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'

import fs from 'fs'

import { HardhatUserConfig } from 'hardhat/config'
import { NetworkUserConfig } from 'hardhat/src/types/config'

// TODO: extract and reuse duplicated code
const mnemonicFileName = process.env.MNEMONIC_FILE
let mnemonic = 'test '.repeat(11) + 'junk'
if (mnemonicFileName != null && fs.existsSync(mnemonicFileName)) {
  mnemonic = fs.readFileSync(mnemonicFileName, 'ascii')
}

function getNetwork (url: string): NetworkUserConfig {
  // if "FORK" is set, then "hardhat node --fork" should be active for this chainId
  if (process.env.FORK != null) {
    return {
      url: 'http://localhost:8544',
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

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.7',
    settings: {
      optimizer: {
        enabled: true
      }
    }
  },
  networks: {
    aaa: getInfuraNetwork('goerli'),
    goerli: getInfuraNetwork('goerli')
  }
}

module.exports = config
