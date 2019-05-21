#!/usr/bin/env node
//helper script, to fund a meta-mask account when working with ganache.

Web3 = require( 'web3')

url = process.env.URL
ethvalue=process.argv[2]
destaddrs = process.argv[3]
acct=process.argv[4] || 0 
if (!ethvalue || !destaddrs) {
	console.log( "usage:", process.argv[1], " {ethvalue} {destaddr} [fromacct] " )
	process.exit(1)
}

let value = ethvalue * 1e18
web3 = new Web3(new Web3.providers.HttpProvider(url||'http://localhost:8545'))
web3.eth.getAccounts().then((accounts) => {
	let from = accounts[acct];
	for (let to of destaddrs.split(',')) {
		web3.eth.getBalance(to).then(res => {
			if (web3.utils.toBN(res).cmp(web3.utils.toBN(value)) > 0) {
				console.log("Account is already funded", to)
				return
			}
			web3.eth.sendTransaction({from, to, value }, (e,r)=>{
				if (e) {
					console.log("Failed to transfer", e)
				} else {
					console.log("Successfully funded", to)
				}
			})
		})
	}
})