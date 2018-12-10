
RelayHub = artifacts.require("RelayHub");

fs=require('fs')

addPastEvents = require( '../src/js/relayclient/addPastEvents' )
addPastEvents(RelayHub)

const testutils = require('./testutils')
const register_new_relay = testutils.register_new_relay;

contract( "test getPastEvents", async (accounts) => {

	topic = "RelayAdded" //= web3.sha3('RelayAdded(address,uint256,uint256,uint256,string)')

	it( "getLogs - truffle", async () => {
		rhub = await RelayHub.deployed()
		let res = await register_new_relay(rhub, 10000000000, 3600, 120, "hello", accounts[9]);

		addPastEvents(RelayHub)
		res = await RelayHub.getPastEvents({fromBlock:1, topics:[topic] })

		//console.log( "logs=",res )
		assert.equal( res[0].event, "RelayAdded")
		//just make sure it has some parsed parameter
		assert.ok( res[0].args.transactionFee )
	})
	it( "getLogs - web3", async () => {
		rhub = await RelayHub.deployed()
		let res = await register_new_relay(rhub, 10000000000, 3600, 120, "hello", accounts[9]);

		abi = require( '../src/js/relayclient/RelayHubApi' )
		RelayHubApi = web3.eth.contract( abi )

		addPastEvents(RelayHubApi)
		res = await RelayHubApi.getPastEvents({fromBlock:1, topics:[topic] })

		//console.log( "logs=",res )
		assert.equal( res[0].event, "RelayAdded")
		//just make sure it has some parsed parameter
		assert.ok( res[0].args.transactionFee )
	})
}) 
