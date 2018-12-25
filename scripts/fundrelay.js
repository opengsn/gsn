#!/usr/bin/env node
const Web3 = require('web3')


const promisify = require("util").promisify

const request = promisify(require("request"))

const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))

const relayhubapi = require( '../src/js/relayclient/RelayHubApi')
const RelayHub = web3.eth.contract(relayhubapi)

async function fundrelay(hubaddr, relayaddr, fromaddr, fund, stake, unstake_delay ) {
    let rhub = RelayHub.at(hubaddr)

    let curstake = await promisify(rhub.stakeOf)(relayaddr);
    if ( curstake > 1e17 ) {
        console.log( "already has a stake of "+(curstake/1e18)+" eth. NOT adding more")
    } else {
        console.log( "staking ",stake)
        console.log(await rhub.stake(relayaddr, unstake_delay, {value: stake, from:fromaddr}))
    }

    let balance = await web3.eth.getBalance(relayaddr)
    if ( balance > 1e17 ) {
        console.log( "already has a balance of "+(stake/1e18)+" eth. NOT adding more")
    } else {
        ret = await new Promise((resolve,reject)=> {
            web3.eth.sendTransaction({from: fromaddr, to: relayaddr,value:fund}, (e, r) => {
                if (e) reject(e)
                else resolve(r)
            })
        })
        console.log(ret)
    }

}

async function run() {
    let hubaddr = process.argv[2]
    let relay = process.argv[3]

    if (relay.indexOf("http") == 0) {
        res = await request(relay+"/getaddr")
        relay = JSON.parse(res.body).RelayServerAddress
    }

    let fromaccount = process.argv[4] || 0

    if (!relay) {
        console.log("usage: fundrelay.js {hubaddr} {relayaddr/url} {from-account}")
        console.log("stake amount is fixed on 1 eth, delay 30 seconds")
        process.exit(1)
    }

    fundrelay(hubaddr, relay, web3.eth.accounts[fromaccount], 1e18, 1e18, 30)

}

run()