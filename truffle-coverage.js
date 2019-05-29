module.exports = {
  compilers: {
    solc: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      version: "0.5.5"
    }
  },
  networks: {
    development: {
      host: "localhost",
      network_id: "*",
      port: 8545,
      // gas: 0xfffffffffff,
      // gasPrice: 0x01
    }
  }
};