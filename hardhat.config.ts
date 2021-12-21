/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import '@nomiclabs/hardhat-truffle5'
import '@nomiclabs/hardhat-web3'
import '@nomiclabs/hardhat-ethers';
import { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  solidity: '0.8.7',
  paths: {
    sources: './packages/contracts/src'
  },
  networks: {
    hardhat: { chainId: 1337 },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    }
  }
}

module.exports = config
