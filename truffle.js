module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  networks: {
  	development: {
		verbose: process.env.VERBOSE,
  		host: "127.0.0.1",
  		port: 8545,
                network_id: "*"//,
                //gasPrice:1,
                //gas:5000000,

  	},
  },
  mocha: {
      slow: 1000
  }
};
