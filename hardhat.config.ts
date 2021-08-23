/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import '@nomiclabs/hardhat-truffle5'
import '@nomiclabs/hardhat-web3'

module.exports = {
  solidity: '0.7.3',
  networks: {
    hardhat: { chainId: 1337 },
    npmtest: { // used from "npm test". see package.json
      verbose: process.env.VERBOSE,
      url: 'http://127.0.0.1:8544',
      network_id: '*'
    }
  }
}
