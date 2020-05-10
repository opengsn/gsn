import net from 'net'

import CommandsLogic, { DeploymentResult } from '../cli/CommandsLogic'
import KeyManager from '../relayserver/KeyManager'

import { configureGSN } from './GSNConfigurator'
import { getNetworkUrl, supportedNetworks } from '../cli/utils'
import { TxStoreManager } from '../relayserver/TxStoreManager'
import RelayServer from '../relayserver/RelayServer'
import HttpServer from '../relayserver/HttpServer'
import { Address } from './types/Aliases'
import { RelayProvider } from './RelayProvider'
import Web3 from 'web3'
import { formatEther, parseEther } from 'ethers/utils'

export interface TestEnvironment {
  deploymentResult: DeploymentResult
  relayProvider: RelayProvider
  httpServer: HttpServer
  relayUrl: string
}

class GsnTestEnvironmentClass {
  private httpServer?: HttpServer

  /**
   *
   * @param host:
   * @param paymaster TODO: will allow using custom paymaster (need to provide ABI file contents)
   * @return
   */
  async startGsn (host?: string, paymaster?: any): Promise<TestEnvironment> {
    await this.stopGsn()
    const _host: string = getNetworkUrl(host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    const commandsLogic = new CommandsLogic(_host, configureGSN({}))
    const from = await commandsLogic.findWealthyAccount()
    if (from == null) {
      throw new Error('could not get unlocked account with sufficient balance')
    }
    const deploymentResult = await commandsLogic.deployGsnContracts(from, undefined, paymaster)
    const balance = await commandsLogic.fundPaymaster(from, deploymentResult.paymasterAddress, parseEther('1').toString())
    console.log('Sample Paymaster successfully funded, balance:', formatEther(balance))

    await this._runServer(_host, deploymentResult, from)
    if (this.httpServer == null) {
      throw new Error('Failed to run a local Relay Server')
    }
    const relayUrl = this.httpServer.backend.url as string

    const registerOptions = {
      from,
      stake: parseEther('1').toString(),
      funds: parseEther('1').toString(),
      relayUrl: relayUrl,
      unstakeDelay: '2000'
    }
    const registrationResult = await commandsLogic.registerRelay(registerOptions)
    if (!registrationResult.success) {
      throw new Error(`failed to register relay: ${registrationResult.error}`)
    }
    if (registrationResult.success) {
      console.log('In-process relay successfully registered:', JSON.stringify(registrationResult))
    } else {
      throw new Error(`Failed to fund relay: ${registrationResult.error} : ${registrationResult?.transactions?.toString()}`)
    }

    await commandsLogic.waitForRelay(relayUrl)

    const config = configureGSN({
      relayHubAddress: deploymentResult.relayHubAddress,
      stakeManagerAddress: deploymentResult.stakeManagerAddress,
      paymasterAddress: deploymentResult.paymasterAddress,
      preferredRelays: [relayUrl]
    })

    const relayProvider = new RelayProvider(new Web3.providers.HttpProvider(_host), config)
    console.error('== startGSN: ready.')
    return {
      deploymentResult,
      relayProvider,
      relayUrl,
      httpServer: this.httpServer
    }
  }

  /**
   * initialize a local relay
   * @private
   */

  private async _resolveAvailablePort (): Promise<number> {
    const server = net.createServer()
    await new Promise(resolve => {
      server.listen(0, resolve)
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Could not find available port')
    }
    const relayListenPort = address.port
    server.close()
    return relayListenPort
  }

  async stopGsn (): Promise<void> {
    if (this.httpServer !== undefined) {
      this.httpServer.stop()
      this.httpServer.close()
      await this.httpServer.backend.txStoreManager.clearAll()
      this.httpServer = undefined
    }
  }

  async _runServer (
    host: string,
    deploymentResult: DeploymentResult,
    from: Address
  ): Promise<void> {
    if (this.httpServer !== undefined) {
      return
    }
    const port = await this._resolveAvailablePort()
    const relayUrl = 'http://127.0.0.1:' + port.toString()

    const keyManager = new KeyManager({
      count: 2
    })
    const txStoreManager = new TxStoreManager({ inMemory: true })

    const backend = new RelayServer({
      web3provider: new Web3.providers.WebsocketProvider(host),
      txStoreManager,
      keyManager,
      owner: from,
      url: relayUrl,
      hubAddress: deploymentResult.relayHubAddress,
      gasPriceFactor: 1,
      baseRelayFee: 0,
      pctRelayFee: 0,
      devMode: true,
      Debug: false
    })

    this.httpServer = new HttpServer({
      port,
      backend
    })
    this.httpServer.start()
  }
}

const GsnTestEnvironment = new GsnTestEnvironmentClass()
export default GsnTestEnvironment
