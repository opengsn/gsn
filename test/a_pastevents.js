/* globals web3 contract it assert artifacts */

const RelayHub = artifacts.require("RelayHub");

const addPastEvents = require( '../src/js/relayclient/addPastEvents' )
addPastEvents(RelayHub)

const testutils = require('./testutils')
const register_new_relay = testutils.register_new_relay;

contract( "test getPastEvents", async (accounts) => {

	let topic = "RelayAdded" //= web3.sha3('RelayAdded(address,uint256,uint256,uint256,string)')

	it( "getLogs - truffle", async () => {
		let rhub = await RelayHub.deployed()
		let res = await register_new_relay(rhub, 10000000000, 3600, 120, "hello", accounts[9]);

		addPastEvents(RelayHub)
		res = await RelayHub.getPastEvents({fromBlock:1, topics:[topic] })

		//console.log( "logs=",res )
		assert.equal( res[0].event, "RelayAdded")
		//just make sure it has some parsed parameter
		assert.ok( res[0].args.transactionFee )
	})
	it( "getLogs - web3", async () => {
		let rhub = await RelayHub.deployed()
		let res = await register_new_relay(rhub, 10000000000, 3600, 120, "hello", accounts[9]);

		let abi = require( '../src/js/relayclient/RelayHubApi' )
		let RelayHubApi = web3.eth.contract( abi )

		addPastEvents(RelayHubApi)
		res = await RelayHubApi.getPastEvents({fromBlock:1, topics:[topic] })

		//console.log( "logs=",res )
		assert.equal( res[0].event, "RelayAdded")
		//just make sure it has some parsed parameter
		assert.ok( res[0].args.transactionFee )
	})
}) 
