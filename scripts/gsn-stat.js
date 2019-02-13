#!/usr/bin/env node
Web3=require('web3')
rp = require('request-promise')
const networks={
    local: "http://127.0.0.1:8545",
    xdai: "https://dai.poa.network",
    ropsten: "https://ropsten.infura.io/v3/c3422181d0594697a38defe7706a1e5b",
    mainnet: "https://mainnet.infura.io/v3/c3422181d0594697a38defe7706a1e5b",
}

net=process.argv[2]

network = networks[net] || net && net.match(/^(https?:.*)?/)[0]

if ( !network ) {
    console.log( "usage: gsn-stat {network} [hubaddr]")
    console.log( "  - network: url or one of: "+Object.keys(networks) )
    console.log( "  - hubaddr: explicit address of a RelayHub (by default, looks for hub with active relays on the network)")
    process.exit(1)
}

let hubaddr = process.argv[3]

web3 = new Web3(new Web3.providers.HttpProvider(network))
RelayHub = require( __dirname+'/../build/contracts/RelayHub.json')

let owners={}
function owner(h) {
	if ( !owners[h] )
	    owners[h] = "owner-"+(Object.keys(owners).length+1)
    return owners[h];
}


/* incomplete:
   fast calculation of block time.
    assuming block rate over a period of time is steady.
    do "triangulation" on blocktime of blocks at 1000 gaps.
    assume current block is on this slope.
 */
let pastblock
async function getBlockTime(n) {
    n1=n-n%1000
    n2=n1+1000

    if ( ! pastblock || (n-pastblock) > 5000 ) {
        pastblock = await web3.eth.getBlock(n-1000)
    }
    return Date( (n-pastblock.number) )
}

async function run() {
	console.log( "network: ", network )

    b = await web3.eth.getBlock('latest')
    // now = new Date(b.timestamp*1000)
	// console.log( "Current block #", b.number, now )

    fromBlock=Math.max(1,b.number-8000)

    if ( !hubaddr ) {
        //all relayed messages in the past time period.
        let allRelayAddedMessages = await web3.eth.getPastLogs({
            fromBlock,
            topics: [web3.utils.sha3('RelayAdded(address,address,uint256,uint256,uint256,string)')]
        })
        let relayHubs = [...new Set(allRelayAddedMessages.map(r => r.address))]

        if (relayHubs.length == 0) {
            console.log("Not RelayHub (with active relays) found. try to specify address")
            process.exit(1)
        }

        if (relayHubs.length > 1) {
            console.log("Found multiple active relay hubs. select one:", relayHubs)
            process.exit(1)
        }
        hubaddr = relayHubs[0]

        //TODO: actually, can extract all info from the above returned RelayAdded messages.
        // however, we need to format them for our contract
    }

    console.log( "hub balance (deposits, stakes)=", (await web3.eth.getBalance(hubaddr))/1e18 )

    r = new web3.eth.Contract(RelayHub.abi, hubaddr)

    res = await r.getPastEvents('RelayAdded', {fromBlock})


    relays={}
    waiters = []
    res.forEach(e=> {

        let r = e.returnValues

        waiters.push(rp({url: r.url + '/getaddr'}).then(ret => relays[r.relay].status = JSON.parse(ret).Ready ? "Ready" : "pending"))
        waiters.push(web3.eth.getBalance(r.relay).then(bal => relays[r.relay].bal = bal / 1e18))

        let aowner = owner(r.owner);
        // console.log( e.blockNumber, e.event, r.url, aowner )
        relays[r.relay] = {url: r.url, owner: aowner, txfee:r.transactionFee, status: "no answer"}
    })
    await Promise.all(waiters)
    console.log( "\n# Relays:")
    Object.values(relays).sort((a,b)=>a.owner>b.owner).forEach(r=> console.log( "-",r.url, "\t"+r.owner, "\t"+r.status, "\ttxfee:"+r.txfee+"%","\tbal", r.bal))

    console.log( "\n# Owners:")
    Object.keys(owners).forEach(k=>{
        let ethBalance = web3.eth.getBalance(k);
        let relayBalance = r.methods.balanceOf(k).call();
        Promise.all([ethBalance,relayBalance]).then(async ()=>{
            console.log( "-", owners[k],":", k, "on-hub:",(await relayBalance)/1e18, "\tbal",(await ethBalance)/1e18  )
        })
    })
   
}

run()

