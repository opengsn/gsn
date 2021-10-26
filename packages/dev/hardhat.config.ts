/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import '@nomiclabs/hardhat-truffle5'
import '@nomiclabs/hardhat-web3'
import 'hardhat-deploy'
import '@nomiclabs/hardhat-ethers';

const fs = require('fs')

const mnemonicFileName = process.env.MNEMONIC_FILE || process.env.HOME + '/.secret/testnet-mnemonic.txt'
let mnemonic = 'test '.repeat(11) + 'junk'
if (fs.existsSync(mnemonicFileName))
  mnemonic = fs.readFileSync(mnemonicFileName!, "ascii");

function getNetwork(url: string) {
  return {
    url,
    accounts: {mnemonic}
  }
}

function infuraNetwork(name: string) {
  return getNetwork(`https://${name}.infura.io/v3/${process.env.INFURA_ID}`)
}


module.exports = {
  solidity: '0.8.7',
  networks: {
    hardhat: { chainId: 1337 },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    },

    dev: getNetwork('http://localhost:8545'),
    goerli: infuraNetwork('goarli'),
    kovan: infuraNetwork('kovan')
  },
  namedAccounts: {
      deployer: 0
  }
}
