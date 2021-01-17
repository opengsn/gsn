import net from 'net'
import { ether } from '@opengsn/common/dist/Utils'

import CommandsLogic from '@opengsn/cli/dist/CommandsLogic'
import { KeyManager } from '@opengsn/relayserver/dist/KeyManager'

import { getNetworkUrl, loadDeployment, supportedNetworks } from '@opengsn/cli/dist/utils'
import { TxStoreManager } from '@opengsn/relayserver/dist/TxStoreManager'
import { RelayServer } from '@opengsn/relayserver/dist/RelayServer'
import { HttpServer } from '@opengsn/relayserver/dist/HttpServer'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { RelayProvider } from '@opengsn/relayclient/dist/RelayProvider'
import Web3 from 'web3'
import ContractInteractor from '@opengsn/common/dist/ContractInteractor'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { configureServer, ServerConfigParams, ServerDependencies } from '@opengsn/relayserver/dist/ServerConfigParams'
import { createServerLogger } from '@opengsn/relayserver/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relayserver/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relayserver/dist/GasPriceFetcher'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'
import { GSNConfig } from '@opengsn/relayclient/dist/GSNConfigurator'
import { GSNUnresolvedConstructorInput } from '@opengsn/relayclient/dist/RelayClient'

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
      gasPrice: '1',
      deployPaymaster: true,
      skipConfirmation: true,
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

    const registerOptions = {
      from,
      stake: ether('1'),
      funds: ether('1'),
      relayUrl: relayUrl,
      gasPrice: '1e9',
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
    const contractInteractor = new ContractInteractor(
      {
        provider: new Web3.providers.HttpProvider(host),
        logger,
        deployment: deploymentResult
      })
    await contractInteractor.init()
    const gasPriceFetcher = new GasPriceFetcher('', '', contractInteractor, logger)

    const relayServerDependencies: ServerDependencies = {
      logger,
      contractInteractor,
      gasPriceFetcher,
      txStoreManager,
      managerKeyManager,
      workersKeyManager
    }
    const relayServerParams: Partial<ServerConfigParams> = {
      devMode: true,
      url: relayUrl,
      relayHubAddress: deploymentResult.relayHubAddress,
      gasPriceFactor: 1,
      baseRelayFee: '0',
      pctRelayFee: 0,
      checkInterval: 10,
      runPaymasterReputations: false,
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
