import net from 'net'
import { ether } from '@opengsn/common/dist/Utils'

import { CommandsLogic, RegisterOptions } from './CommandsLogic'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'

import { getNetworkUrl, loadDeployment, supportedNetworks } from './utils'
import { TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { HttpServer } from '@opengsn/relay/dist/HttpServer'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import Web3 from 'web3'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { configureServer, ServerConfigParams, ServerDependencies } from '@opengsn/relay/dist/ServerConfigParams'
import { createServerLogger } from '@opengsn/relay/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relay/dist/GasPriceFetcher'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { GSNUnresolvedConstructorInput } from '@opengsn/provider/dist/RelayClient'
import { ReputationStoreManager } from '@opengsn/relay/dist/ReputationStoreManager'
import { ReputationManager } from '@opengsn/relay/dist/ReputationManager'

export interface TestEnvironment {
  contractsDeployment: GSNContractsDeployment
  relayProvider: RelayProvider
  httpServer: HttpServer
  relayUrl: string
}

class GsnTestEnvironmentClass {
  private httpServer?: HttpServer

  /**
   *
   * @param host:
   * @return
   */
  async startGsn (host: string): Promise<TestEnvironment> {
    await this.stopGsn()
    const _host: string = getNetworkUrl(host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    const logger = createServerLogger('error', '', '')
    const commandsLogic = new CommandsLogic(_host, logger, {})
    await commandsLogic.init()
    const from = await commandsLogic.findWealthyAccount()
    const deploymentResult = await commandsLogic.deployGsnContracts({
      from,
      gasPrice: 1e9.toString(),
      gasLimit: 5000000,
      deployPaymaster: true,
      skipConfirmation: true,
      penalizerConfiguration: defaultEnvironment.penalizerConfiguration,
      relayHubConfiguration: defaultEnvironment.relayHubConfiguration
    })
    if (deploymentResult.paymasterAddress != null) {
      const balance = await commandsLogic.fundPaymaster(from, deploymentResult.paymasterAddress, ether('1'))
      console.log('Naive Paymaster successfully funded, balance:', Web3.utils.fromWei(balance))
    }

    const port = await this._resolveAvailablePort()
    const relayUrl = 'http://127.0.0.1:' + port.toString()
    await this._runServer(_host, deploymentResult, from, relayUrl, port)
    if (this.httpServer == null) {
      throw new Error('Failed to run a local Relay Server')
    }

    const registerOptions: RegisterOptions = {
      from,
      sleepMs: 100,
      sleepCount: 5,
      stake: ether('1'),
      funds: ether('1'),
      relayUrl: relayUrl,
      gasPrice: 1e9.toString(),
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

    const config: Partial<GSNConfig> = {
      preferredRelays: [relayUrl],
      paymasterAddress: deploymentResult.paymasterAddress
    }
    const provider = new Web3.providers.HttpProvider(_host)
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config
    }
    const relayProvider = await RelayProvider.newProvider(input).init()
    console.error('== startGSN: ready.')
    return {
      contractsDeployment: deploymentResult,
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
      await this.httpServer.relayService?.transactionManager.txStoreManager.clearAll()
      this.httpServer = undefined
    }
  }

  async _runServer (
    host: string,
    deploymentResult: GSNContractsDeployment,
    from: Address,
    relayUrl: string,
    port: number
  ): Promise<void> {
    if (this.httpServer !== undefined) {
      return
    }

    const logger = createServerLogger('error', '', '')
    const managerKeyManager = new KeyManager(1)
    const workersKeyManager = new KeyManager(1)
    const txStoreManager = new TxStoreManager({ inMemory: true }, logger)
    const maxPageSize = Number.MAX_SAFE_INTEGER
    const contractInteractor = new ContractInteractor(
      {
        provider: new Web3.providers.HttpProvider(host),
        logger,
        maxPageSize,
        deployment: deploymentResult
      })
    await contractInteractor.init()
    const gasPriceFetcher = new GasPriceFetcher('', '', contractInteractor, logger)

    const reputationStoreManager = new ReputationStoreManager({ inMemory: true }, logger)
    const reputationManager = new ReputationManager(reputationStoreManager, logger, { initialReputation: 10 })

    const relayServerDependencies: ServerDependencies = {
      logger,
      contractInteractor,
      gasPriceFetcher,
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      reputationManager
    }
    const relayServerParams: Partial<ServerConfigParams> = {
      devMode: true,
      url: relayUrl,
      relayHubAddress: deploymentResult.relayHubAddress,
      ownerAddress: from,
      gasPriceFactor: 1,
      baseRelayFee: '0',
      pctRelayFee: 0,
      checkInterval: 50,
      refreshStateTimeoutBlocks: 1,
      runPaymasterReputations: true,
      logLevel: 'error'
    }
    const transactionManager = new TransactionManager(relayServerDependencies, configureServer(relayServerParams))
    const backend = new RelayServer(relayServerParams, transactionManager, relayServerDependencies)
    await backend.init()

    this.httpServer = new HttpServer(
      port,
      logger,
      backend
    )
    this.httpServer.start()
  }

  /**
   * return deployment saved by "gsn start"
   * @param workdir
   */
  loadDeployment (workdir = './build/gsn'): GSNContractsDeployment {
    return loadDeployment(workdir)
  }
}

export const GsnTestEnvironment = new GsnTestEnvironmentClass()
