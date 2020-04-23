// yarn add -D @nomiclabs/buidler @nomiclabs/buidler-truffle5 @nomiclabs/buidler-web3
// buidler test - supports stack traces, logs (also faster to launch than truffle)
// buidler test --network ganache : just faster launcher
// for logs:
//   import "nomiclabs/buidler/console.log";
//   console.log("a=%s addr=%s", 1, this);

require( 'ts-node/register')
// eslint-disable-next-line no-undef
usePlugin('@nomiclabs/buidler-truffle5')
require( 'ts-node/register')
module.exports = {
  networks: {
    buidlerevm: {
      gas: 1e8,
      blockGasLimit: 1e8
    },
    ganache: {
      url: 'http://localhost:8545'
    }
  },
  solc: {
    version: '0.5.16',
    optimizer: {
      enabled: true,
      runs: 1
    }
  }
}
