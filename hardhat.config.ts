/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const chainId = process.env.CHAINID == null ? 1337 : parseInt(process.env.CHAINID)
module.exports = {
  solidity: '0.8.7',
  networks: {
    hardhat: { chainId },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    }
  }
}
