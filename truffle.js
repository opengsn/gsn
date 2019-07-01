var HDWalletProvider = require("truffle-hdwallet-provider");
var mnemonic = "digital unknown jealous mother legal hedgehog save glory december universe spread figure custom found six"

const secret_mnemonic_file = "./secret_mnemonic"
const fs=require('fs')
let secret_mnemonic
if (fs.existsSync(secret_mnemonic_file)) {
  secret_mnemonic = fs.readFileSync(secret_mnemonic_file , {encoding:'utf8'})
}

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  networks: {

    development: {
      provider: undefined,
     	verbose: process.env.VERBOSE,
  		host: "127.0.0.1",
  		port: 8545,
      network_id: "*"
    },
    coverage: { //coverage/trace provider. note that it currently can't run extrnal-process relay.
	     provider : require( './coverage-prov.js' ),
	     verbose: process.env.VERBOSE,
       network_id: "*"
    },
    npmtest: { //used from "npm test". see pakcage.json
		  verbose: process.env.VERBOSE,
  		host: "127.0.0.1",
  		port: 8544,
      network_id: "*",
    },
    ropsten: {
      provider: function() {
        return new HDWalletProvider(mnemonic, "https://ropsten.infura.io/v3/c3422181d0594697a38defe7706a1e5b")
      },
      network_id: 3
    },
    xdai_poa_mainnet: {
      provider: function() {
        let wallet = new HDWalletProvider(secret_mnemonic, "https://dai.poa.network")
        return wallet
      },
      network_id: 100
    }
  },
  mocha: {
      slow: 1000
  },
  compilers: {
    solc: {
      version: "0.5.10",
    },
  }
};
