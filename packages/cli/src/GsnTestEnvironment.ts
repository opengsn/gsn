import net from 'net'
import {
  Address,
  ContractInteractor,
  GSNContractsDeployment,
  LoggerInterface,
  constants,
  defaultEnvironment,
  ether,
  isSameAddress
} from '@opengsn/common'

import { StaticJsonRpcProvider } from '@ethersproject/providers'

import { CommandsLogic, RegisterOptions } from './CommandsLogic'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'

import { getNetworkUrl, loadDeployment, supportedNetworks } from './utils'
import { TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { HttpServer } from '@opengsn/relay/dist/HttpServer'

import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import Web3 from 'web3'

import { configureServer, ServerConfigParams, ServerDependencies } from '@opengsn/relay/dist/ServerConfigParams'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relay/dist/GasPriceFetcher'

import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { GSNUnresolvedConstructorInput } from '@opengsn/provider/dist/RelayClient'
import { ReputationStoreManager } from '@opengsn/relay/dist/ReputationStoreManager'
import { ReputationManager } from '@opengsn/relay/dist/ReputationManager'

import { ChildProcess } from 'child_process'
import { Web3MethodsBuilder } from '@opengsn/relay/dist/Web3MethodsBuilder'
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'

export interface TestEnvironment {
  contractsDeployment: GSNContractsDeployment
  relayProvider: RelayProvider
  httpServer: HttpServer
  relayUrl: string
  hardhatNode?: ChildProcess
}

class GsnTestEnvironmentClass {
  private httpServer?: HttpServer

  /**
   *
   * @param host:
   * @param logger
   * @return
   */
  async deployGsn (host: string, logger?: LoggerInterface): Promise<GSNContractsDeployment> {
    const _host: string = getNetworkUrl(host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    logger = logger ?? createServerLogger('error', '', '')
    const commandsLogic = new CommandsLogic(_host, logger, {})
    await commandsLogic.init()
    const from = await commandsLogic.findWealthyAccount()
    const deploymentResult = await commandsLogic.deployGsnContracts({
      from,
      burnAddress: constants.BURN_ADDRESS,
      devAddress: constants.BURN_ADDRESS,
      minimumTokenStake: 1,
      gasPrice: 1e9.toString(),
      gasLimit: 5000000,
      deployTestToken: true,
      deployPaymaster: true,
      skipConfirmation: true,
      penalizerConfiguration: defaultEnvironment.penalizerConfiguration,
      relayHubConfiguration: defaultEnvironment.relayHubConfiguration
    })
    logger?.info(`Deployed GSN\n${JSON.stringify(deploymentResult)}`)

    if (deploymentResult.paymasterAddress != null) {
      const balance = await commandsLogic.fundPaymaster(from, deploymentResult.paymasterAddress, ether('1'))
      logger?.info(`Naive Paymaster successfully funded, balance: ${Web3.utils.fromWei(balance)}`)
    }

    return deploymentResult
  }

  /**
   *
   * @param host - the Ethereum RPC node URL
   * @param localRelayUrl - the local GSN RelayServer URL for RelayRegistrar
   * @param port - the port for the RelayServer to listen to (optional)
   * @param logger
   * @return
   */
  async startGsn (
    host: string,
    localRelayUrl: string = 'http://127.0.0.1/',
    port?: number,
    logger?: LoggerInterface
  ): Promise<TestEnvironment> {
    await this.stopGsn()
    const _host: string = getNetworkUrl(host)
    if (_host == null) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`startGsn: expected network (${supportedNetworks().join('|')}) or url`)
    }
    logger = logger ?? createCommandsLogger('error')
    const deploymentResult = await this.deployGsn(host, logger)
    const commandsLogic = new CommandsLogic(_host, logger, {})
    await commandsLogic.init()
    const from = await commandsLogic.findWealthyAccount()

    port = port ?? await this._resolveAvailablePort()
    const url = new URL(localRelayUrl)
    url.port = port.toString()
    const relayUrl = url.toString()
    await this._runServer(_host, deploymentResult, from, relayUrl, port, logger)
    if (this.httpServer == null) {
      throw new Error('Failed to run a local Relay Server')
    }

    const registerOptions: RegisterOptions = {
      // force using default (wrapped eth) token
      wrap: true,
      from,
      sleepMs: 100,
      sleepCount: 5,
      stake: '1',
      funds: ether('5'),
      relayUrl: relayUrl,
      gasPrice: 1e9.toString(),
      unstakeDelay: '15000'
    }
    const registrationResult = await commandsLogic.registerRelay(registerOptions)
    if (registrationResult.success) {
      logger?.info(`In-process relay successfully registered: ${JSON.stringify(registrationResult)}`)
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Failed to fund relay: ${registrationResult.error} : ${registrationResult?.transactions?.toString()}`)
    }

    await commandsLogic.waitForRelay(relayUrl)

    const config: Partial<GSNConfig> = {
      preferredRelays: [relayUrl],
      paymasterAddress: deploymentResult.paymasterAddress
    }
    const provider = new StaticJsonRpcProvider(_host)
    const input: GSNUnresolvedConstructorInput = {
      overrideDependencies: { logger },
      provider,
      config
    }
    const relayProvider = await RelayProvider.newProvider(input).init()
    logger.error('== startGSN: ready.')
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
      // @ts-ignore
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
    port: number,
    logger: LoggerInterface
  ): Promise<void> {
    if (this.httpServer !== undefined) {
      return
    }

    const managerKeyManager = new KeyManager(1)
    const workersKeyManager = new KeyManager(1)
    const txStoreManager = new TxStoreManager({ inMemory: true }, logger)
    const maxPageSize = Number.MAX_SAFE_INTEGER
    const environment = defaultEnvironment
    const provider = new StaticJsonRpcProvider(host)
    const contractInteractor = new ContractInteractor(
      {
        provider,
        logger,
        maxPageSize,
        environment,
        deployment: deploymentResult
      })
    await contractInteractor.init()
    const resolvedDeployment = contractInteractor.getDeployment()
    const httpProvider = new Web3.providers.HttpProvider(host)
    const web3MethodsBuilder = new Web3MethodsBuilder(new Web3(httpProvider), resolvedDeployment)
    const gasPriceFetcher = new GasPriceFetcher('', '', contractInteractor, logger)

    const reputationStoreManager = new ReputationStoreManager({ inMemory: true }, logger)
    const reputationManager = new ReputationManager(reputationStoreManager, logger, { initialReputation: 10 })

    const relayServerDependencies: ServerDependencies = {
      logger,
      contractInteractor,
      web3MethodsBuilder,
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
      checkInterval: 50,
      refreshStateTimeoutBlocks: 1,
      runPaymasterReputations: true,
      logLevel: 'error',
      workerTargetBalance: 1e18
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
   * @param url - an Ethereum RPC API Node URL
   */
  async loadDeployment (
    url: string,
    workdir = './build/gsn'
  ): Promise<GSNContractsDeployment> {
    const deployment = loadDeployment(workdir)
    const provider = new StaticJsonRpcProvider(url)
    const contractInteractor = new ContractInteractor(
      {
        provider,
        logger: console,
        maxPageSize: Number.MAX_SAFE_INTEGER,
        environment: defaultEnvironment,
        deployment
      })
    await contractInteractor.initDeployment(deployment)
    await contractInteractor._validateERC165InterfacesClient(true)
    await contractInteractor._validateERC165InterfacesRelay()
    const tokenAddress = deployment.managerStakeTokenAddress
    if (tokenAddress != null && !isSameAddress(tokenAddress, constants.ZERO_ADDRESS)) {
      const code = await contractInteractor.getCode(tokenAddress)
      if (code.length <= 2) {
        throw new Error(`No contract deployed for ERC-20 ManagerStakeTokenAddress at ${tokenAddress}`)
      }
    }
    return deployment
  }
}

export const GsnTestEnvironment = new GsnTestEnvironmentClass()
