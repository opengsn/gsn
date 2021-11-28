module.exports = {
  solidity: {
    version: '0.8.7',
    settings: {
      optimizer: { enabled: true }
    }
  },
  paths: {
    sources: './contracts-src', // symlink, since hardhat can't reference "../contracts/src"
    artifacts: './artifacts'
  },
  networks: {
    hardhat: { chainId: 1337 },
    mainnet: { url: `https://mainnet.infura.io/v3/${process.env.INFURA_ID}` },
    npmtest: { // used from "npm test". see package.json
      url: 'http://127.0.0.1:8544'
    }
  }
}
