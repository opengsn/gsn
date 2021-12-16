import * as bip39 from 'ethereum-cryptography/bip39'
import commander from 'commander'
import fs from 'fs'
import Web3 from 'web3'
import { HttpProvider } from 'web3-core'
import { hdkey as EthereumHDKey } from 'ethereumjs-wallet'

import {
  LoggerInterface
} from '@opengsn/common'
import { Address, Web3ProviderBaseInterface } from '@opengsn/common/dist/types/Aliases'
import { BatchRelayProvider } from '@opengsn/provider/dist/bls/BatchRelayProvider'
import { GSNConfig, GSNDependencies, GSNUnresolvedConstructorInput, RelayProvider } from '@opengsn/provider'
import { GSNBatchingUnresolvedConstructorInput } from '@opengsn/provider/dist/bls/BatchRelayClient'

import { getMnemonic, getNetworkUrl, gsnCommander } from '../utils'
import { CommandsLogic } from '../CommandsLogic'
import { createCommandsLogger } from '../CommandsWinstonLogger'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import HDWalletProvider from '@truffle/hdwallet-provider'
import { PrefixedHexString } from 'ethereumjs-util'

function commaSeparatedList (value: string, _dummyPrevious: string[]): string[] {
  return value.split(',')
}

interface GsnSendRequestDeployment {
  to: Address
  paymaster: Address
  batchGateway: Address
  batchGatewayCacheDecoder: Address
  authorizationsRegistrar: Address
  blsVerifierContract: Address
  erc20CacheDecoder: Address
}

gsnCommander(['n', 'f', 'm', 'g'])
  .option('--relay', 'whether to run transaction with relay or directly', false)
  .option('--batching', 'whether to run transaction inside a batch or individually', false)
  .option('--abiFile <string>', 'path to an ABI truffle artifact JSON file')
  .option('--method <string>', 'method name to execute')
  .option('--methodParams <items>', 'comma separated args list', commaSeparatedList)
  .option('--calldata <string>', 'exact calldata to use')
  .option('--deployment <string>', 'path to the deployment info JSON file')
  .option('--blsKeystore <string>', 'path to the BLS keystore JSON file')
  .parse(process.argv)

async function getProvider (
  deployment: GsnSendRequestDeployment,
  mnemonic: string | undefined,
  logger: LoggerInterface,
  host: string): Promise<{ provider: Web3ProviderBaseInterface, from: Address }> {
  const config: Partial<GSNConfig> = {
    clientId: '0',
    paymasterAddress: deployment.paymaster
  }
  const provider = new Web3.providers.HttpProvider(host, {
    keepAlive: true,
    timeout: 120000
  })
  let from: Address
  let privateKey: PrefixedHexString | undefined
  if (commander.from != null) {
    // provider-controlled private key
    from = commander.from
    console.log('using', from)
  } else if (mnemonic != null) {
    const hdwallet = EthereumHDKey.fromMasterSeed(
      bip39.mnemonicToSeedSync(mnemonic)
    )
    // add mnemonic private key to the account manager as an 'ephemeral key'
    const wallet = hdwallet.deriveChild(0).getWallet()
    from = `0x${wallet.getAddress().toString('hex')}`
    privateKey = `0x${wallet.getPrivateKey().toString('hex')}`
    console.log('mnemonic account:', from)
  } else {
    throw new Error('must specify either "--mnemonic" or pass "--from" account')
  }
  if (commander.relay !== true) {
    return { provider, from }
  } else {
    const overrideDependencies: Partial<GSNDependencies> = {
      logger
    }
    if (commander.batching !== true) {
      const input: GSNUnresolvedConstructorInput = {
        provider,
        config,
        overrideDependencies
      }
      const relayProvider = await RelayProvider.newProvider(input).init()
      if (privateKey != null) {
        relayProvider.relayClient.dependencies.accountManager.addAccount(privateKey)
      }
      return {
        provider: relayProvider,
        from
      }
    } else {
      const input: GSNBatchingUnresolvedConstructorInput = {
        provider,
        config,
        overrideDependencies,
        batchingContractsDeployment: deployment,
        target: deployment.to,
        calldataCacheDecoder: deployment.erc20CacheDecoder
      }
      const batchRelayProvider = await BatchRelayProvider.newBatchingProvider(input).init()
      await new BLSTypedDataSigner().init() // TODO: wasm global init
      if (privateKey != null) {
        batchRelayProvider.relayClient.dependencies.accountManager.addAccount(privateKey)
      }
      const blsKeypair = JSON.parse(fs.readFileSync(commander.blsKeystore, { encoding: 'utf8' }))
      await batchRelayProvider.relayClient.dependencies.accountManager.setBLSKeypair(blsKeypair)
      return {
        provider: batchRelayProvider,
        from
      }
    }
  }
}

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)
  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic)
  const deployment: GsnSendRequestDeployment = JSON.parse(fs.readFileSync(commander.deployment, 'utf8'))
  const { provider, from } = await getProvider(
    deployment,
    mnemonic,
    logger,
    nodeURL
  )
  const abiJson = JSON.parse(fs.readFileSync(commander.abiFile, 'utf8'))
  const web3Contract = logic.contract(abiJson, deployment.to)
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
    gas: 100000,
    forceGasPrice: 8000000000
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
