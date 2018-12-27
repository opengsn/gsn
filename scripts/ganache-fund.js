#!/usr/bin/env node
//helper script, to fund a meta-mask account when working with ganache.

Web3 = require( 'web3')

url = process.env.URL
ethvalue=process.argv[2]
destaddr = process.argv[3]
acct=process.argv[4] || 0 
if ( ! ethvalue ) {
	console.log( "usage:", process.argv[1], " {ethvalue} {destaddr} [fromacct] " )
	process.exit(1)
}

web3 = new Web3(new Web3.providers.HttpProvider(url||'http://localhost:8545'))

web3.eth.sendTransaction({from: web3.eth.accounts[acct], to: destaddr, value: ethvalue*1e18 }, (e,r)=>{
	if (e) {
		console.log( "Failed to transfer: ",e)
	} else {
		console.log( "Successfully funded" )
	}
})

