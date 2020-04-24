import RelayClient, { RelayingResult } from './RelayClient'
import RelayServer from '../relayserver/RelayServer'
import HttpServer from '../relayserver/HttpServer'
import { sleep } from '../common/utils'
import { HttpProvider, provider } from 'web3-core'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { IKnownRelaysManager } from './KnownRelaysManager'
import { RelayInfoUrl, RelayRegisteredEventInfo } from './types/RelayRegisteredEventInfo'
import { GSNConfig, GSNDependencies } from './GSNConfigurator'
import { Address } from './types/Aliases'
import { IStakeManagerInstance } from '../../types/truffle-contracts'
import stakeManagerAbi from '../common/interfaces/IStakeManager'
import { TxStoreManager } from '../relayserver/TxStoreManager'
import axios from 'axios'
import net from 'net'

import KeyManager = require('../relayserver/KeyManager')

const unstakeDelay = 2000

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
  const keyManager = new KeyManager({ count: 2, workdir: devConfig.relayWorkdir })
  const txStoreManager = new TxStoreManager({ inMemory: true })

  // @ts-ignore
  const relayServer = new RelayServer({
    web3provider,
    txStoreManager,
    keyManager,
    // owner: relayOwner,
    hubAddress: relayHub,
    url: devConfig.relayUrl,
    baseRelayFee: devConfig.baseRelayFee,
    pctRelayFee: devConfig.pctRelayFee,
    gasPriceFactor: devConfig.gasPriceFactor,
    devMode: devConfig.devMode
  })
  relayServer.on('error', (e: any) => {
    // console.error('ERR:', e.message)
  })

  const httpServer = new HttpServer({
    port: devConfig.relayListenPort,
    backend: relayServer
  })
  httpServer.start()
  return {
    httpServer,
    relayServer
  }
}

class DevKnownRelays implements IKnownRelaysManager {
  async getRelaysSortedForTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayInfoUrl[][]> {
    // @ts-ignore
    return Promise.resolve([[this.devRelay]])
  }

  async refresh (): Promise<void> { // ts-ignore
  }

  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void { // ts-ignore
  }

  async getRelayInfoForManagers (relayManagers: Set<Address>): Promise<RelayRegisteredEventInfo[]> {
    return Promise.resolve([])
  }

  devRelay?: RelayRegisteredEventInfo
}

export interface DevGSNConfig extends Partial<GSNConfig> {
  relayOwner: Address
  relayWorkdir?: string // if specified, saves (and reuses) relay address (and avoid re-register)
  relayListenPort?: number // defaults to dynamic port
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
        knownRelaysManager: new DevKnownRelays()
      })
    this.devConfig = this.config as DevGSNConfig
  }

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

    let relayListenPort = this.devConfig.relayListenPort
    // find free port:
    if (relayListenPort === undefined) {
      const server = net.createServer()
      await new Promise(resolve => {
        server.listen(0, resolve)
      })
      // @ts-ignore
      relayListenPort = server.address().port
      server.close()
    }

    // eslint-disable-next-line
    const relayUrl = this.devConfig.relayUrl ?? 'http://localhost:' + relayListenPort!.toString()

    // flag early, so only the first call will try to bring up a relay
    // (TODO: other calls should still wait for the relay to start)
    this.serverStarted = true

    const web3provider = this.contractInteractor.getProvider()
    const { httpServer, relayServer } = await runServer(
      web3provider,
      this.config.relayHubAddress,
      {
        ...this.devConfig,
        relayListenPort,
        relayUrl
      }
    )
    this.relayServer = relayServer
    this.httpServer = httpServer

    // @ts-ignore
    const IStakeManagerContract: Contract<IStakeManagerInstance> = TruffleContract({
      contractName: 'IStakeManager',
      abi: stakeManagerAbi
    })
    IStakeManagerContract.setProvider(this.contractInteractor.getProvider(), undefined)

    const stakeManager = await IStakeManagerContract.at(stakeManagerAddress)

    await stakeManager.contract.methods.stakeForAddress(relayServer.getManagerAddress(), unstakeDelay).send({ from: this.devConfig.relayOwner, value: 1e18 })
    // not sure why: the line below started to crash on: Number can only safely store up to 53 bits
    // (and its not relayed - its a direct call)
    // await stakeManager.stakeForAddress(relayServer.getManagerAddress(), unstakeDelay, {
    //   from: this.devConfig.relayOwner,
    //   value: ether('1'),
    // })
    await stakeManager.authorizeHub(relayServer.getManagerAddress(), this.config.relayHubAddress, { from: this.devConfig.relayOwner })
    await this.contractInteractor.getWeb3().eth.sendTransaction({
      from: this.devConfig.relayOwner,
      to: relayServer.getManagerAddress(),
      value: 1e18
    })
    // @ts-ignore
    const relayInfo = await waitForRelay(relayServer.url as string + '/getaddr', 5000, (res) => {
      if (res?.data?.Ready === true) {
        return {
          relayManager: res.data.RelayServerAddress,
          pctRelayFee: '0',
          baseRelayFee: '0',
          // @ts-ignore
          relayUrl: relayServer.url
        }
      }
    })

    const devRelays = this.knownRelaysManager as DevKnownRelays
    devRelays.devRelay = relayInfo
  }

  debug (...args: any): void {
    if (this.config.verbose) console.log(...args)
  }
}
