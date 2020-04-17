import RelayClient, { RelayingResult } from './RelayClient'
import RelayServer from '../relayserver/RelayServer'
import HttpServer from '../relayserver/HttpServer'
import { sleep } from '../common/utils'
import { HttpProvider, provider } from 'web3-core'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import KnownRelaysManager from './KnownRelaysManager'
import RelayRegisteredEventInfo from './types/RelayRegisteredEventInfo'
import { GSNConfig, GSNDependencies } from './GSNConfigurator'
import { Address } from './types/Aliases'
import { IStakeManagerInstance } from '../../types/truffle-contracts'
import { ether } from '@openzeppelin/test-helpers'
import stakeManagerAbi from '../common/interfaces/IStakeManager'
import { TxStoreManager } from '../relayserver/TxStoreManager'
import axios from 'axios'

import KeyManager = require('../relayserver/KeyManager')

const dayInSec = 24 * 60 * 60
const weekInSec = dayInSec * 7

import TruffleContract = require('@truffle/contract')
import Contract = Truffle.Contract

// wait for relay until waitFunction return true value, or until a timeout.
async function waitForRelay (url: string, timeout: number, waitFunction: (res: any) => RelayRegisteredEventInfo | undefined): Promise<RelayRegisteredEventInfo> {
  const timeoutTime = Date.now() + timeout
  while (Date.now() <= timeoutTime) {
    let res
    try {
      res = await axios.get(url)
    } catch (e) {
      res = e
    }
    const ret = waitFunction(res)
    if (ret != null) {
      return ret
    }
    await sleep(400)
  }
  throw new Error('waitForRelay: timed-out')
}

interface RunServerReturn {
  httpServer: HttpServer
  relayServer: RelayServer
}

export function runServer (
  web3provider: provider,
  relayHub: string,
  devConfig: DevGSNConfig
): RunServerReturn {
  const relayUrl = devConfig.relayUrl ?? `http://localhost:${devConfig.relayListenPort}`

  // TODO: read key-pair from temp file?
  // (otherwise, we deploy a new relay each time)
  const keyManager = new KeyManager({ ecdsaKeyPair: KeyManager.newKeypair(), workdir: undefined })
  const txStoreManager = new TxStoreManager({ inMemory: true })

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
    // console.error('ERR:', e.message)
  })

  let listenPort = devConfig.relayListenPort
  if (listenPort === undefined) {
    const m = relayUrl.match(/(?:(https?):\/\/(\S+?)(?::(\d+))?)?$/)
    if (m != null) {
      if (!m[0].startsWith('http')) {
        throw Error('invalid server URL protocol ' + m[0])
      }
      listenPort = (m[3] !== undefined) ? parseInt(m[3]) : (m[0] === 'http' ? 80 : 443)
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

class DevKnownRelays { // extends  KnownRelaysManager {
  // noinspection JSUnusedGlobalSymbols
  getRelaysSorted (): RelayRegisteredEventInfo[] {
    // @ts-ignore
    return [this.devRelay]
  }

  // noinspection JSUnusedGlobalSymbols
  refresh (): void { // ts-ignore
  }

  devRelay?: RelayRegisteredEventInfo
}

export interface DevGSNConfig extends Partial<GSNConfig> {
  relayOwner: Address
  relayWorkdir?: string
  relayListenPort?: number
  relayUrl?: string // defaults to http://localhost:{relayListenPort}

  // TODO: this is actually relay config
  baseRelayFee?: number
  pctRelayFee?: number
  gasPriceFactor: number
  devMode?: boolean
}

export class DevRelayClient extends RelayClient {
  serverStarted: boolean = false
  httpServer?: HttpServer
  relayServer?: RelayServer
  private readonly devConfig: DevGSNConfig;

  constructor (
    provider: HttpProvider,
    devConfig: Partial<DevGSNConfig>,
    overrideDependencies?: Partial<GSNDependencies>
  ) {
    super(provider, devConfig,
      {
        ...overrideDependencies,
        knownRelaysManager: new DevKnownRelays() as KnownRelaysManager
      })
    this.devConfig = this.config as DevGSNConfig
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
  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    await this._initializeRelay()
    return super.relayTransaction(gsnTransactionDetails)
  }

  // stop background relay
  async stopRelay (): Promise<void> {
    if (!this.serverStarted) {
      return
    }
    if (this.httpServer !== undefined) {
      this.httpServer.stop()
      this.httpServer = undefined
    }
    if (this.relayServer !== undefined) {
      // @ts-ignore
      await this.relayServer.txStoreManager.clearAll()
      this.relayServer.stop()
      this.relayServer = undefined
    }
  }

  /**
     * initialize a local relay
     * @private
     */
  async _initializeRelay (): Promise<void> {
    if (this.serverStarted) {
      return
    }

    const hub = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
    const stakeManagerAddress = await hub.getStakeManager()

    // flag early, so only the first call will try to bring up a relay
    // (TODO: other calls should still wait for the relay to start)
    this.serverStarted = true

    // const {
    //   relayOwner, relayWorkdir, relayHub, relayListenPort,
    //   baseRelayFee, pctRelayFee, gasPriceFactor, devMode
    // } = this.config

    const web3provider = this.contractInteractor.provider
    const { httpServer, relayServer } = await runServer(
      web3provider,
      this.config.relayHubAddress,
      this.devConfig
    )
    this.relayServer = relayServer
    this.httpServer = httpServer

    // @ts-ignore
    const IStakeManagerContract: Contract<IStakeManagerInstance> = TruffleContract({
      contractName: 'IStakeManager',
      abi: stakeManagerAbi
    })
    IStakeManagerContract.setProvider(this.contractInteractor.provider, undefined)

    const stakeManager = await IStakeManagerContract.at(stakeManagerAddress)

    const estim = await stakeManager.contract.methods.stakeForAddress(relayServer.address, weekInSec)
      .estimateGas({ value: 1e18 })
    this.debug('== staking relay gas estim:', estim)
    await stakeManager.stakeForAddress(relayServer.address, weekInSec, {
      from: this.devConfig.relayOwner,
      value: ether('1'),
      gas: estim
    })
    this.debug('== sending balance to relayServer', relayServer.address)
    await stakeManager.authorizeHub(relayServer.address, this.config.relayHubAddress, { from: this.devConfig.relayOwner })
    await this.contractInteractor.web3.eth.sendTransaction({
      from: this.devConfig.relayOwner,
      to: relayServer.address,
      value: 1e18
    })
    this.debug('== waiting for relay')
    // @ts-ignore
    const relayInfo = await waitForRelay(relayServer.url as string + '/getaddr', 5000, (res) => {
      if (res?.data?.Ready === true) {
        return {
          ...res.data,
          pctRelayFee: '0',
          baseRelayFee: '0',
          // @ts-ignore
          relayUrl: relayServer.url
        }
      }
    })

    const devRelays = this.knownRelaysManager as DevKnownRelays
    devRelays.devRelay = relayInfo

    this.debug('== relay ready')
  }

  debug (...args: any): void {
    if (this.config.verbose) console.log(...args)
  }
}
