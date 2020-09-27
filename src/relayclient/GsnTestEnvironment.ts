import net from 'net'
import { ether } from '../common/Utils'

import CommandsLogic, { DeploymentResult } from '../cli/CommandsLogic'
import { KeyManager } from '../relayserver/KeyManager'

import { configureGSN } from './GSNConfigurator'
import { getNetworkUrl, loadDeployment, supportedNetworks } from '../cli/utils'
import { TxStoreManager } from '../relayserver/TxStoreManager'
import { RelayServer } from '../relayserver/RelayServer'
import { HttpServer } from '../relayserver/HttpServer'
import { Address } from './types/Aliases'
import { RelayProvider } from './RelayProvider'
import Web3 from 'web3'
import ContractInteractor from './ContractInteractor'
import { defaultEnvironment } from '../common/Environments'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'

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
   * @param deployPaymaster - whether to deploy the naive paymaster instance for tests
   * @return
   */
  async startGsn (host?: string, deployPaymaster: boolean = true): Promise<TestEnvironment> {
    await this.stopGsn()
    const _host: string = getNetworkUrl(host)
    console.log('_host=', _host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    const commandsLogic = new CommandsLogic(_host, configureGSN({}))
    const from = await commandsLogic.findWealthyAccount()
    const deploymentResult = await commandsLogic.deployGsnContracts({
      from,
      gasPrice: '1',
      deployPaymaster,
      skipConfirmation: true,
      relayHubConfiguration: defaultEnvironment.relayHubConfiguration
    })
    if (deployPaymaster) {
      const balance = await commandsLogic.fundPaymaster(from, deploymentResult.naivePaymasterAddress, ether('1'))
      console.log('Naive Paymaster successfully funded, balance:', Web3.utils.fromWei(balance))
    }

    const port = await this._resolveAvailablePort()
    const relayUrl = 'http://127.0.0.1:' + port.toString()
    await this._runServer(_host, deploymentResult, from, relayUrl, port)
    if (this.httpServer == null) {
      throw new Error('Failed to run a local Relay Server')
    }

    const registerOptions = {
      from,
      stake: ether('1'),
      funds: ether('1'),
      relayUrl: relayUrl,
      unstakeDelay: '2000'
    }
    const registrationResult = await commandsLogic.registerRelay(registerOptions)
    if (registrationResult.success) {
      console.log('In-process relay successfully registered:', JSON.stringify(registrationResult))
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to fund relay: ${registrationResult.error} : ${registrationResult?.transactions?.toString()}`)
    }

    await commandsLogic.waitForRelay(relayUrl)

    const config = configureGSN({
      logLevel: 5,
      relayHubAddress: deploymentResult.relayHubAddress,
      paymasterAddress: deploymentResult.naivePaymasterAddress,
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
      await this.httpServer.backend.transactionManager.txStoreManager.clearAll()
      this.httpServer = undefined
    }
  }

  async _runServer (
    host: string,
    deploymentResult: DeploymentResult,
    from: Address,
    relayUrl: string,
    port: number
  ): Promise<void> {
    if (this.httpServer !== undefined) {
      return
    }

    const managerKeyManager = new KeyManager(1)
    const workersKeyManager = new KeyManager(1)
    const txStoreManager = new TxStoreManager({ inMemory: true })
    const contractInteractor = new ContractInteractor(new Web3.providers.HttpProvider(host),
      configureGSN({
        logLevel: 5,
        relayHubAddress: deploymentResult.relayHubAddress
      }))
    await contractInteractor.init()
    const relayServerDependencies = {
      contractInteractor,
      txStoreManager,
      managerKeyManager,
      workersKeyManager
    }
    const relayServerParams: Partial<ServerConfigParams> = {
      url: relayUrl,
      relayHubAddress: deploymentResult.relayHubAddress,
      gasPriceFactor: 1,
      baseRelayFee: '0',
      pctRelayFee: 0,
      checkInterval: 10,
      logLevel: 5
    }
    const backend = new RelayServer(relayServerParams, relayServerDependencies)
    await backend.init()

    this.httpServer = new HttpServer(
      port,
      backend
    )
    this.httpServer.start()
  }

  /**
   * return deployment saved by "gsn start"
   * @param workdir
   */
  loadDeployment (workdir = './build/gsn'): DeploymentResult {
    return loadDeployment(workdir)
  }
}

export const GsnTestEnvironment = new GsnTestEnvironmentClass()
