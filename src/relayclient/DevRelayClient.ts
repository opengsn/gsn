import RelayClient, {EmptyApprove, GasPricePingFilter, RelayingResult} from './RelayClient'
import RelayServer from '../relayserver/RelayServer'
import HttpServer from '../relayserver/HttpServer'
import {sleep} from '../common/utils'
import {HttpProvider, provider} from 'web3-core'
import GsnTransactionDetails from "./types/GsnTransactionDetails";
import KnownRelaysManager, {EmptyFilter} from "./KnownRelaysManager";
import RelayRegisteredEventInfo from "./types/RelayRegisteredEventInfo";
import {GSNConfig, RelayClientConfig} from "./GSNConfigurator";
import Web3 from "web3";
import HttpClient from "./HttpClient";
import ContractInteractor from "./ContractInteractor";
import AccountManager from "./AccountManager";
import RelayedTransactionValidator from "./RelayedTransactionValidator";
import {Address, AsyncApprove, PingFilter} from "./types/Aliases";
import HttpWrapper from "./HttpWrapper";
import {defaultEnvironment} from "./types/Environments";
import {StakeManagerInstance} from "../../types/truffle-contracts";

const ow = require('ow')
const KeyManager = require('../relayserver/KeyManager')
const TxStoreManager = require('../relayserver/TxStoreManager').TxStoreManager
const RelayHubABI = require('../common/interfaces/IRelayHub')
const StakeManagerABI = require('../common/interfaces/IStakeManager')
const axios = require('axios')

const dayInSec = 24 * 60 * 60
const weekInSec = dayInSec * 7

// wait for relay until waitFuntion return true value, or until a timeout.
async function waitForRelay(url: string, timeout: number, waitFunction: (res: any) => RelayRegisteredEventInfo | undefined) : Promise<RelayRegisteredEventInfo> {
    const timeoutTime = Date.now() + timeout
    while (Date.now() <= timeoutTime) {
        let res
        try {
            res = await axios.get(url)
        } catch (e) {
            res = e
        }
        const ret = waitFunction(res)
        if (ret) {
            return ret
        }
        await sleep(400)
    }
    throw new Error('timed-out')
}

export async function runServer(
    web3provider: provider,
    relayHub: string,
    devConfig: DevClientConfig
) {
    const relayUrl = devConfig.relayUrl || `http://localhost:${devConfig.listenPort}`

    // TODO: read key-pair from temp file?
    // (otherwise, we deploy a new relay each time)
    const keyManager = new KeyManager({ecdsaKeyPair: KeyManager.newKeypair()})
    const txStoreManager = new TxStoreManager({workdir: devConfig.workdir})

    // @ts-ignore
    const relayServer = new RelayServer({
        web3provider,
        txStoreManager,
        keyManager,
        // owner: relayOwner,
        hubAddress: relayHub,
        url: relayUrl,
        baseRelayFee: devConfig.baseRelayFee,
        pctRelayFee: devConfig.pctRelayFee,
        gasPriceFactor: devConfig.gasPriceFactor,
        devMode: devConfig.devMode
    })
    relayServer.on('error', (e: any) => {
        console.error('ERR:', e.message)
    })

    let listenPort = devConfig.listenPort
    if (!listenPort) {
        const m = relayUrl.match(/(?:(https?):\/\/(\S+?)(?::(\d+))?)?$/)
        if (m != null) {
            if (!m[0].startsWith('http')) {
                throw Error('invalid server URL protocol ' + m[0])
            }
            listenPort = m[3] ? parseInt(m[3]) : (m[0] === 'http' ? 80 : 443)
        }
    }

    const httpServer = new HttpServer({
        port: listenPort,
        backend: relayServer
    })
    httpServer.start()
    return {
        httpServer,
        relayServer
    }
}

class DevKnownRelays { //extends  KnownRelaysManager {

    getRelaysSorted(): RelayRegisteredEventInfo[] {
        return [this.devRelay!]
    }

    refresh() {}
    devRelay?: RelayRegisteredEventInfo
}

interface DevClientConfig {
    relayOwner: Address,
    workdir ?: string,
    listenPort ?: number,
    relayUrl ?: string, // defaults to http://localhost:{listenPort}

    // TODO: this is actually relay config
    baseRelayFee ?: number,
    pctRelayFee ?: number,
    gasPriceFactor : number,
    devMode ?: boolean
}

export default class DevRelayClient extends RelayClient {

    serverStarted: boolean = false
    httpServer?: HttpServer
    relayServer?: RelayServer
    private devConfig: DevClientConfig;

    constructor(
        web3: Web3,
        devConfig: DevClientConfig,
        config: RelayClientConfig,
        gsnConfig: GSNConfig,
        httpWrapper = new HttpWrapper(),
        httpClient = new HttpClient(httpWrapper, {verbose: false}),
        contractInteractor = new ContractInteractor(web3.currentProvider, gsnConfig.contractInteractorConfig),
        knownRelaysManager = new DevKnownRelays() as KnownRelaysManager,
            //new KnownRelaysManager(web3, gsnConfig.relayHubAddress, contractInteractor, EmptyFilter, gsnConfig.knownRelaysManagerConfig),
        accountManager = new AccountManager(web3, defaultEnvironment.chainId, gsnConfig.accountManagerConfig),
        transactionValidator = new RelayedTransactionValidator(contractInteractor, gsnConfig.relayHubAddress, defaultEnvironment.chainId, gsnConfig.transactionValidatorConfig),
        pingFilter = GasPricePingFilter,
        asyncApprove = EmptyApprove,
    ) {
        super(web3, httpClient, contractInteractor, knownRelaysManager, accountManager, transactionValidator, gsnConfig.relayHubAddress, pingFilter, asyncApprove, config)
        this.devConfig = devConfig
    }

    /**
     * Options include standard transaction params: from,to, gas_price, gas_limit
     * relay-specific params:
     *  pctRelayFee (override config.pctRelayFee)
     *  validateCanRelay - client calls canRelay before calling the relay the first time (defaults to true)
     *  paymaster - the contract that is compensating the relay for the gas (defaults to transaction destination 'to')
     * can also override default relayUrl, relayFee
     * return value is the same as from sendTransaction
     */
    async relayTransaction(gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {

        await this._initializeRelay()
        return super.relayTransaction(gsnTransactionDetails)
    }

    // stop background relay
    stop() {
        if (!this.serverStarted) {
            return
        }
        if (this.httpServer) {
            this.httpServer.stop()
            this.httpServer = undefined
        }
        if (this.relayServer) {
            this.relayServer.stop()
            this.relayServer = undefined
        }
    }

    /**
     * initialize a local relay
     * @private
     */
    async _initializeRelay() {
        if (this.serverStarted) {
            return
        }

        const hub = new this.web3.eth.Contract(RelayHubABI, this.relayHub)
        const stakeManagerAddress = await hub.methods.getStakeManager().call()

        // flag early, so only the first call will try to bring up a relay
        // (TODO: other calls should still wait for the relay to start)
        this.serverStarted = true

        // const {
        //   relayOwner, workdir, relayHub, listenPort,
        //   baseRelayFee, pctRelayFee, gasPriceFactor, devMode
        // } = this.config

        const web3provider = this.web3.currentProvider
        const {httpServer, relayServer} = await runServer(
            web3provider,
            this.relayHub,
            this.devConfig
        )
        this.relayServer = relayServer
        this.httpServer = httpServer

        const stakeManager = new this.web3.eth.Contract(StakeManagerABI, stakeManagerAddress)
        const estim = await stakeManager.methods.stakeForAddress(relayServer.address, weekInSec)
            .estimateGas({value: 1e18})
        this.debug('== staking relay gas estim:', estim)
        await stakeManager.methods.stakeForAddress(relayServer.address, weekInSec).send({
            from: this.devConfig.relayOwner,
            value: 1e18,
            gas: estim
        })
        this.debug('== sending balance to relayServer', relayServer.address)
        await stakeManager.methods.authorizeHub(relayServer.address, this.relayHub).send({from: this.devConfig.relayOwner})
        await this.web3.eth.sendTransaction({
            from: this.devConfig.relayOwner,
            to: relayServer.address,
            value: 1e18
        })
        this.debug('== waiting for relay')
        const relayInfo = await waitForRelay(relayServer.url + '/getaddr', 5000, (res) => {
            if ( res && res.data && res.data.Ready ) {
              return {
                ...res.data,
                  pctRelayFee:'0',
                  baseRelayFee:'0',
                relayUrl: relayServer.url
              }
            }
        });

        console.log("relayinfo=", relayInfo);
        const devRelays = this.knownRelaysManager as DevKnownRelays
        devRelays.devRelay = relayInfo

        this.debug('== relay ready')
    }

    debug(...args: any) {
        if (this.config.verbose) console.log(...args)
    }
}
