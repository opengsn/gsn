
var RelayHub, RelayRecipient

var relayurl_input

var owner, hub

function log() {
    window.main.innerHTML += "\n" + Array.prototype.slice.call(arguments).join(" ")+"<br>"
}

async function getHub(hubaddr) {

    if ( !RelayHub )
        RelayHub = await readContract('relayclient/RelayHubApi.js')
    return RelayHub.at(hubaddr)
}

async function saveHubAndOwner(hubaddr, owneracct) {

    owner = web3.eth.accounts[owneracct]
    hub = await getHub(hubaddr)

    log( "Hub address = ",hub.address)
}

async function checkRelay(relayurl, newBalance, newStake , newDelay) {
    // log( "checkRelay: url="+relayurl, 'bal='+newBalance, 'stake='+newStake, 'del='+newDelay)
    let httpget
    try {
        httpget = await httpreq(relayurl+"/getaddr");
    } catch (e) {
        log( "failed to connect to: "+relayurl+": "+e)
        return
    }
    let resp = JSON.parse(httpget.response)
    let relayaddr = resp.RelayServerAddress

    log( "relay addr=", relayaddr, "ready=",resp.Ready)

    let currentOwner = await promisify(hub.ownerOf)(relayaddr)
    if ( currentOwner == '0x') {
        log( "Relay not owned: waiting for owner")
    } else
    if ( currentOwner == owner ) {
        log( "Relay ready")
    } else {
        log( "NOT OUR RELAY: owned by: "+currentOwner)
    }

    balance = await promisify(web3.eth.getBalance)(relayaddr)
    log("current balance=", balance / 1e18)

    stake = await promisify(hub.stakeOf)(relayaddr)
    log( "current stake=", stake/1e18)

    if ( newStake ) {
        diffStake = newStake * 1e18 - stake
        if (diffStake > 0) {

            delayUnit = (newDelay || "30s").match(/^([\d.]+)\s*([smhd])/)
            if (!delayUnit)
                return log("invalid Stake time: must be {number} {sec|min|hour|day}")

            units = {'s': 1, 'm': 60, 'h': 3600, 'd': 3600 * 24}
            //convert "1.5m" into 90
            delay = delayUnit[1] * units[delayUnit[2]]

            await promisify(hub.stake)(relayaddr, delay, {from: owner, value: diffStake})
            stake = await promisify(hub.stakeOf)(relayaddr)
            log("after new stake=", stake / 1e18)
        } else {
            log("Stake unmodified")
        }
    }
    if ( newBalance ){
        diffBalance = newBalance*1e18 - balance

        if ( diffBalance>0 ) {
            await promisify(web3.eth.sendTransaction)({from:owner, to:relayaddr, value:diffBalance })
            balance = await promisify(web3.eth.getBalance)(relayaddr)
            log("after new balance balance=", balance / 1e18)
        } else {
            log( "Balance unmodified")
        }
    }
}

async function depositFor(addr, eth_amount) {
    hub = await getRelayHub(addr)
    console.log("hub=",hub)
    hub.depositFor(addr, {from:web3.eth.accounts[0], value:eth_amount*1e18}, (e,r)=> {
        if (e) log("failed deposit: " + e)
        else log( "deposited "+eth_amount+" to "+addr+". wait for confirmation..")
    })
}

function saveForm(form) {
    let ret = Array.prototype.slice.call(form.children)
        .filter(a=>a.type=='text')
        .map(c=>c.id+"="+c.value)
        .join( "~")
    saveCookie("relayform", ret)
}

function loadForm(form) {
    val = getCookie("relayform")
    if (!val ) return
    val.split("~").forEach(s=>{
        let nameval = s.match(/\b([^=]+)=(.*)/);
        if ( nameval ) {
            name=nameval[1]; val=nameval[2]
            if ( form.children[name] )
                form.children[name].value = val
            else
                console.log( "name not found for  "+name+"="+val)
        }
        else
            console.log( "invalid cookie value "+s)
    })
}

function start() {

    let dataform= document.getElementById('dataform')
    loadForm(dataform)
saveHubAndOwner(dataform.children.hubaddr.value, dataform.children.owner.value)
}

window.addEventListener('load', start)
