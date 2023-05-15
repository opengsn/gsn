import * as bip39 from 'ethereum-cryptography/bip39'

import Web3 from 'web3'
import commander from 'commander'
import fs from 'fs'
import { PrefixedHexString } from 'ethereumjs-util'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { hdkey as EthereumHDKey } from 'ethereumjs-wallet'
import { toHex, toWei } from 'web3-utils'
import { HttpProvider } from 'web3-core'

import {
  Address,
  LoggerInterface
} from '@opengsn/common'

import { GSNConfig, GSNDependencies, GSNUnresolvedConstructorInput, RelayProvider } from '@opengsn/provider'
import { createCommandsLogger } from '@opengsn/logger/dist/CommandsWinstonLogger'

import { getMnemonic, getNetworkUrl, gsnCommander } from '../utils'
import { CommandsLogic } from '../CommandsLogic'

function commaSeparatedList (value: string, _dummyPrevious: string[]): string[] {
  return value.split(',')
}

gsnCommander(['n', 'f', 'm', 'g', 'l'])
  .option('--directCall', 'whether to run transaction with relay or directly', false)
  .option('--abiFile <string>', 'path to an ABI truffle artifact JSON file')
  .option('--method <string>', 'method name to execute')
  .option('--methodParams <items>', 'comma separated args list', commaSeparatedList)
  .option('--calldata <string>', 'exact calldata to use')
  .option('--to <string>', 'target RelayRecipient contract')
  .option('--paymaster <string>', 'the Paymaster contract to be used')
  .parse(process.argv)

async function getProvider (
  to: Address,
  paymaster: Address,
  mnemonic: string | undefined,
  logger: LoggerInterface,
  host: string): Promise<{ provider: HttpProvider, from: Address }> {
  const config: Partial<GSNConfig> = {
    clientId: '0',
    paymasterAddress: paymaster
  }
  let from: Address
  let privateKey: PrefixedHexString | undefined
  if (commander.from != null) {
    // provider-controlled private key
    from = commander.from
    console.log('using', from)
  } else if (mnemonic != null) {
    const hdwallet = EthereumHDKey.fromMasterSeed(
      Buffer.from(bip39.mnemonicToSeedSync(mnemonic))
    )
    // add mnemonic private key to the account manager as an 'ephemeral key'
    const wallet = hdwallet.deriveChild(0).getWallet()
    from = `0x${wallet.getAddress().toString('hex')}`
    privateKey = `0x${wallet.getPrivateKey().toString('hex')}`
    console.log('mnemonic account:', from)
  } else {
    throw new Error('must specify either "--mnemonic" or pass "--from" account')
  }
  if (commander.directCall === true) {
    const provider = new Web3.providers.HttpProvider(host, {
      keepAlive: true,
      timeout: 120000
    })
    return { provider, from }
  } else {
    if (paymaster == null) {
      throw new Error('--paymaster: address not specified')
    }
    const overrideDependencies: Partial<GSNDependencies> = {
      logger
    }
    const provider = new StaticJsonRpcProvider(host)
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config,
      overrideDependencies
    }
    const relayProvider = await RelayProvider.newWeb3Provider(input)
    if (privateKey != null) {
      relayProvider.addAccount(privateKey)
    }
    return {
      provider: relayProvider,
      from
    }
  }
}

(async () => {
  const network: string = commander.network
  const nodeURL = getNetworkUrl(network)
  const logger = createCommandsLogger(commander.loglevel)
  const mnemonic = getMnemonic(commander.mnemonic)
  const logic = new CommandsLogic(nodeURL, logger, {}, mnemonic, commander.derivationPath, commander.derivationIndex, commander.privateKeyHex)
  const { provider, from } = await getProvider(
    commander.to,
    commander.paymaster,
    mnemonic,
    logger,
    nodeURL
  )
  if (commander.abiFile == null || !fs.existsSync(commander.abiFile)) {
    const file: string = commander.abiFile
    throw new Error(`--abiFile: ABI file ${file} does not exist`)
  }
  const abiJson = JSON.parse(fs.readFileSync(commander.abiFile, 'utf8'))
  if (commander.to == null) {
    throw new Error('--to: target address is missing')
  }
  const web3Contract = logic.contract(abiJson, commander.to)
  // @ts-ignore
  web3Contract.setProvider(provider, undefined)

  const calldata = commander.calldata
  const methodName: string = commander.method
  if (calldata != null && methodName != null) {
    throw new Error('Cannot pass both --calldata and --method')
  }
  if (calldata == null && methodName == null) {
    throw new Error('Must pass either --calldata or --method')
  }

  const method = web3Contract.methods[methodName]
  if (method == null) {
    throw new Error(`Method (${methodName}) is not found on contract`)
  }
  const methodParams = commander.methodParams

  const gasPrice = toHex(commander.gasPrice != null ? toWei(commander.gasPrice, 'gwei').toString() : await logic.getGasPrice())
  const gas = commander.gasLimit

  const receipt = await method(...methodParams).send({
    from,
    gas,
    gasPrice
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
