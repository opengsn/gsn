// TODO: allow reading network URLs from 'truffle-config.js'
import commander, { CommanderStatic } from 'commander'
import fs from 'fs'
import path from 'path'

import { Address, RelayHubConfiguration, GSNContractsDeployment, LoggerInterface } from '@opengsn/common'

import { ServerConfigParams } from '@opengsn/relay/dist/ServerConfigParams'

const cliInfuraId = '$INFURA_ID'
export const networks = new Map<string, string>([
  ['localhost', 'http://127.0.0.1:8545'],
  ['xdai', 'https://dai.poa.network'],
  ['arbitrum_rinkeby', 'https://rinkeby.arbitrum.io/rpc'],
  ['optimism_kovan', 'https://kovan.optimism.io/'],
  ['ropsten', 'https://ropsten.infura.io/v3/' + cliInfuraId],
  ['rinkeby', 'https://rinkeby.infura.io/v3/' + cliInfuraId],
  ['kovan', 'https://kovan.infura.io/v3/' + cliInfuraId],
  ['goerli', 'https://goerli.infura.io/v3/' + cliInfuraId],
  ['mainnet', 'https://mainnet.infura.io/v3/' + cliInfuraId]
])

export const networksBlockExplorers = new Map<string, string>([
  ['xdai', 'https://blockscout.com/poa/xdai/'],
  ['arbitrum_rinkeby', 'https://rinkeby-explorer.arbitrum.io/#/'],
  ['optimism_kovan', 'https://kovan-optimistic.etherscan.io/'],
  ['ropsten', 'https://ropsten.etherscan.io/'],
  ['rinkeby', 'https://rinkeby.etherscan.io/'],
  ['kovan', 'https://kovan.etherscan.io/'],
  ['goerli', 'https://goerli.etherscan.io/'],
  ['mainnet', 'https://etherscan.io/']
])

export function supportedNetworks (): string[] {
  return Array.from(networks.keys())
}

export function getNetworkUrl (network: string, env: { [key: string]: string | undefined } = process.env): string {
  const net = networks.get(network)
  if (net == null) {
    const match = network.match(/^(https?:\/\/.*)/) ?? []
    const firstMatch = match[0]
    if (firstMatch == null) {
      throw new Error(`network ${network} is not supported`)
    }
    return firstMatch
  }

  if (net.includes('$INFURA_ID')) {
    const str = env.INFURA_ID ?? ''
    if (str === '') { throw new Error(`network ${network}: INFURA_ID not set`) }
    return net.replace(/\$INFURA_ID/, str)
  }

  return net
}

export function getMnemonic (mnemonicFile: string): string | undefined {
  if (mnemonicFile == null || mnemonicFile === '') {
    return
  }
  console.log('Using mnemonic from file ' + mnemonicFile)
  return fs.readFileSync(mnemonicFile, { encoding: 'utf8' }).replace(/\r?\n|\r/g, '')
}

export function getKeystorePath (keystorePath: string): string {
  if (!fs.existsSync(keystorePath)) {
    throw new Error(`keystorePath ${keystorePath} not found`)
  }
  if (fs.lstatSync(keystorePath).isDirectory() && fs.existsSync(keystorePath + '/keystore')) {
    return keystorePath
  } else if (fs.lstatSync(keystorePath).isFile() && path.basename(keystorePath) === 'keystore') {
    return path.dirname(keystorePath)
  }
  throw new Error(`keystorePath ${keystorePath} not a file or directory`)
}

export function getServerConfig (configFilename: string): ServerConfigParams {
  if (!fs.existsSync(configFilename) || !fs.lstatSync(configFilename).isFile()) {
    throw new Error(`configFilename ${configFilename} must be a file`)
  }
  return JSON.parse(fs.readFileSync(configFilename, 'utf8'))
}

export function getRelayHubConfiguration (configFile: string): RelayHubConfiguration | undefined {
  if (configFile == null) {
    return
  }
  console.log('Using hub config from file ' + configFile)
  const file = fs.readFileSync(configFile, { encoding: 'utf8' })
  return JSON.parse(file)
}

export function getPaymasterAddress (paymaster?: string): string | undefined {
  return getAddressFromFile('build/gsn/Paymaster.json', paymaster)
}

export function getRelayHubAddress (defaultAddress?: string): string | undefined {
  return getAddressFromFile('build/gsn/RelayHub.json', defaultAddress)
}

function getAddressFromFile (path: string, defaultAddress?: string): string | undefined {
  if (defaultAddress == null) {
    if (fs.existsSync(path)) {
      const relayHubDeployInfo = fs.readFileSync(path).toString()
      return JSON.parse(relayHubDeployInfo).address
    }
  }
  return defaultAddress
}

function saveContractToFile (address: Address | undefined, workdir: string, filename: string): void {
  if (address == null) {
    throw new Error('Address is not initialized!')
  }
  fs.mkdirSync(workdir, { recursive: true })
  fs.writeFileSync(path.join(workdir, filename), `{ "address": "${address}" }`)
}

export function saveDeployment (deploymentResult: GSNContractsDeployment, workdir: string): void {
  saveContractToFile(deploymentResult.stakeManagerAddress, workdir, 'StakeManager.json')
  saveContractToFile(deploymentResult.penalizerAddress, workdir, 'Penalizer.json')
  saveContractToFile(deploymentResult.relayHubAddress, workdir, 'RelayHub.json')
  saveContractToFile(deploymentResult.paymasterAddress, workdir, 'Paymaster.json')
  saveContractToFile(deploymentResult.forwarderAddress, workdir, 'Forwarder.json')
  saveContractToFile(deploymentResult.relayRegistrarAddress, workdir, 'RelayRegistrar.json')
  saveContractToFile(deploymentResult.managerStakeTokenAddress, workdir, 'ManagerStakeTokenAddress.json')
}

export function showDeployment (
  deploymentResult: GSNContractsDeployment,
  title: string | undefined,
  logger: LoggerInterface,
  paymasterTitle: string | undefined = undefined
): void {
  if (title != null) {
    logger.error(title)
  }
  logger.error(`
  RelayHub: ${deploymentResult.relayHubAddress}
  RelayRegistrar: ${deploymentResult.relayRegistrarAddress}
  StakeManager: ${deploymentResult.stakeManagerAddress}
  Penalizer: ${deploymentResult.penalizerAddress}
  Forwarder: ${deploymentResult.forwarderAddress}
  TestToken (test only): ${deploymentResult.managerStakeTokenAddress}
  Paymaster ${paymasterTitle != null ? '(' + paymasterTitle + ')' : ''}: ${deploymentResult.paymasterAddress}`)
}

export function loadDeployment (workdir: string): GSNContractsDeployment {
  function getAddress (name: string): string {
    return getAddressFromFile(path.join(workdir, name + '.json')) as string
  }

  return {
    relayHubAddress: getAddress('RelayHub'),
    relayRegistrarAddress: getAddress('RelayRegistrar'),
    stakeManagerAddress: getAddress('StakeManager'),
    managerStakeTokenAddress: getAddress('ManagerStakeTokenAddress'),
    penalizerAddress: getAddress('Penalizer'),
    forwarderAddress: getAddress('Forwarder'),
    paymasterAddress: getAddress('Paymaster')
  }
}

type GsnOption = 'n' | 'f' | 'h' | 'm' | 'g' | 'l'

export function gsnCommander (options: GsnOption[]): CommanderStatic {
  options.forEach(option => {
    switch (option) {
      case 'n':
        commander.option('-n, --network <url|name>', 'network name or URL to an Ethereum node', 'localhost')
        break
      case 'f':
        commander.option('-f, --from <address>', 'account to send transactions from (default: the first account with balance)')
        break
      case 'h':
        commander.option('-h, --hub <address>', 'address of the hub contract (default: the address from build/gsn/RelayHub.json if exists)')
        break
      case 'm':
        commander.option('-m, --mnemonic <mnemonic>', 'mnemonic file to generate private key for account \'from\'')
        commander.option('--derivationPath <string>', 'derivation path for the mnemonic to use, defaults to m/44\'/60\'/0\'/0/')
        commander.option('--derivationIndex <string>', 'derivation index to use with a given mnemonic, defaults to 0', '0')
        commander.option('--privateKeyHex <string>', 'private key to use directly without mnemonic')
        break
      case 'g':
        commander.option('-g, --gasPrice <number>', 'gas price to give to the transaction, in gwei.')
        break
      case 'l':
        commander.option('-l, --gasLimit <number>', 'gas limit to give to all transactions', '5000000')
        break
    }
  })
  commander.option('--loglevel <string>', 'silent | error | warn | info | debug', 'debug')
  return commander
}
