import commander from 'commander'
import fs from 'fs'
import Web3 from 'web3'
import { HttpProvider } from 'web3-core'

import { getMnemonic, getNetworkUrl, gsnCommander } from '../utils'
import { GSNConfig, GSNDependencies, GSNUnresolvedConstructorInput, RelayProvider } from '@opengsn/provider'
import { CommandsLogic } from '../CommandsLogic'
import { createCommandsLogger } from '../CommandsWinstonLogger'
import { ObjectMap, Web3ProviderBaseInterface } from '@opengsn/common/dist/types/Aliases'
import { BatchRelayProvider } from '@opengsn/provider/dist/bls/BatchRelayProvider'
import {
  ContractInteractor, defaultEnvironment,
  GSNBatchingContractsDeployment, gsnRequiredVersion,
  gsnRuntimeVersion,
  LoggerInterface,
  VersionsManager
} from '@opengsn/common'
import { CacheDecoderInteractor, CachingGasConstants } from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { ICalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ICalldataCacheDecoderInteractor'
import { ERC20CalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ERC20CalldataCacheDecoderInteractor'

function commaSeparatedList (value: string, _dummyPrevious: string[]): string[] {
  return value.split(',')
}

gsnCommander(['n', 'f', 'm', 'g'])
  .option('--relay', 'whether to run transaction with relay or directly', false)
  .option('--batching', 'whether to run transaction inside a batch or individually', false)
  .option('--abiFile <string>', 'path to an ABI file')
  .option('--method <string>', 'method name to execute')
  .option('--methodParams <items>', 'comma separated args list', commaSeparatedList)
  .option('--calldata <string>', 'exact calldata to use')
  .option('--to <address>', 'target contract address')
  .option('--paymaster <address>', 'paymaster')
  .option('--batchGateway <address>', 'batchGateway')
  .option('--batchGatewayCacheDecoder <address>', 'batchGatewayCacheDecoder')
  .option('--authorizationsRegistrar <address>', 'authorizationsRegistrar')
  .option('--blsVerifierContract <address>', 'blsVerifierContract')
  .option('--erc20CacheDecoder <address>', 'erc20CacheDecoder')
  .parse(process.argv)

async function getProvider (
  relay: boolean,
  batching: boolean,
  logger: LoggerInterface,
  host: string): Promise<Web3ProviderBaseInterface> {
  const config: Partial<GSNConfig> = {
    paymasterAddress: commander.paymaster
  }
  const provider: HttpProvider = new Web3.providers.HttpProvider(host, {
    keepAlive: true,
    timeout: 120000
  })
  if (!relay) {
    return provider
  } else {
    const overrideDependencies: Partial<GSNDependencies> = {
      logger
    }
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config,
      overrideDependencies
    }
    if (!batching) {
      return await RelayProvider.newProvider(input).init()
    } else {
      const batchingContractsDeployment: GSNBatchingContractsDeployment = {
        batchGateway: commander.batchGateway,
        batchGatewayCacheDecoder: commander.batchGatewayCacheDecoder,
        authorizationsRegistrar: commander.authorizationsRegistrar
      }
      // TODO: this monstrous deployment is mostly not needed, refactor!
      const contractInteractor = new ContractInteractor({
        provider,
        logger,
        environment: defaultEnvironment,
        maxPageSize: 0,
        versionManager: new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion),
        deployment: {}
      })
      const calldataCacheDecoderInteractors: ObjectMap<ICalldataCacheDecoderInteractor> = {}
      calldataCacheDecoderInteractors[commander.to.toLowerCase()] = new ERC20CalldataCacheDecoderInteractor({
        provider,
        erc20CacheDecoderAddress: commander.erc20CacheDecoder
      })
      const cachingGasConstants: CachingGasConstants = {
        authorizationCalldataBytesLength: 1,
        authorizationStorageSlots: 1,
        gasPerSlotL2: 1
      }
      const cacheDecoderInteractor = new CacheDecoderInteractor({
        provider,
        batchingContractsDeployment,
        contractInteractor,
        calldataCacheDecoderInteractors,
        cachingGasConstants
      })
      await cacheDecoderInteractor.init()
      const batchRelayProvider = await BatchRelayProvider.newBatchingProvider(input, batchingContractsDeployment, cacheDecoderInteractor).init()
      await batchRelayProvider.relayClient.dependencies.accountManager.newBLSKeypair()
      return batchRelayProvider
    }
  }
}

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)
  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic)
  const from = commander.from ?? await logic.findWealthyAccount()
  const provider = await getProvider(
    commander.relay,
    commander.batching,
    logger,
    nodeURL
  )
  const abiJson = JSON.parse(fs.readFileSync(commander.abiFile, 'utf8'))
  const web3Contract = logic.contract(abiJson, commander.to)
  // @ts-ignore
  web3Contract.setProvider(provider, undefined)

  const calldata = commander.calldata
  const methodName: string = commander.method
  if (calldata != null && methodName != null) {
    throw new Error('Cannot pass both calldata and method')
  }
  if (calldata == null && methodName == null) {
    throw new Error('Must pass either calldata or method')
  }

  const method = web3Contract.methods[methodName]
  if (method == null) {
    throw new Error(`Method (${methodName}) is not found on contract`)
  }
  const methodParams = commander.methodParams

  const receipt = await method(...methodParams).send({
    from,
    gas: 100000
  })
  console.log(receipt)

  console.log(JSON.stringify(methodParams))
  console.log(web3Contract.options.address)
  process.exit(0)
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
