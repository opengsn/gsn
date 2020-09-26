// TODO: allow reading network URLs from 'truffle-config.js'
import commander, { CommanderStatic } from 'commander'
import fs from 'fs'
import { Address } from '../relayclient/types/Aliases'
import path from 'path'
import { DeploymentResult } from './CommandsLogic'
import { RelayHubConfiguration } from '../relayclient/types/RelayHubConfiguration'

const cliInfuraId = '$INFURA_ID'
export const networks = new Map<string, string>([
  ['localhost', 'http://127.0.0.1:8545'],
  ['xdai', 'https://dai.poa.network'],
  ['ropsten', 'https://ropsten.infura.io/v3/' + cliInfuraId],
  ['rinkeby', 'https://rinkeby.infura.io/v3/' + cliInfuraId],
  ['kovan', 'https://kovan.infura.io/v3/' + cliInfuraId],
  ['goerli', 'https://goerli.infura.io/v3/' + cliInfuraId],
  ['mainnet', 'https://mainnet.infura.io/v3/' + cliInfuraId]
])

export function supportedNetworks (): string[] {
  return Array.from(networks.keys())
}

export function getNetworkUrl (network: string, env: {[key: string]: string|undefined} = process.env): string {
  const net = networks.get(network)
  if (net == null) {
    const match = network.match(/^(https?:\/\/.*)/) ?? []
    return match[0]
  }

  function getEnvParam (substring: string, ...args: string[]): string {
    const param = args[0]
    const str = env[param] ?? ''
    if (str === '') { throw new Error(`network ${network}: ${param} not set`) }
    return str
  }

  return net.replace(/\$(\w+)/g, getEnvParam)
}

export function getMnemonic (mnemonicFile: string): string | undefined {
  if (mnemonicFile == null) {
    return
  }
  console.log('Using mnemonic from file ' + mnemonicFile)
  return fs.readFileSync(mnemonicFile, { encoding: 'utf8' }).replace(/\r?\n|\r/g, '')
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

export function getRegistryAddress (defaultAddress?: string): string | undefined {
  return getAddressFromFile('build/gsn/VersionRegistry.json', defaultAddress)
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

function saveContractToFile (address: Address, workdir: string, filename: string): void {
  fs.mkdirSync(workdir, { recursive: true })
  fs.writeFileSync(path.join(workdir, filename), `{ "address": "${address}" }`)
}

export function saveDeployment (deploymentResult: DeploymentResult, workdir: string): void {
  saveContractToFile(deploymentResult.stakeManagerAddress, workdir, 'StakeManager.json')
  saveContractToFile(deploymentResult.penalizerAddress, workdir, 'Penalizer.json')
  saveContractToFile(deploymentResult.relayHubAddress, workdir, 'RelayHub.json')
  saveContractToFile(deploymentResult.naivePaymasterAddress, workdir, 'Paymaster.json')
  saveContractToFile(deploymentResult.forwarderAddress, workdir, 'Forwarder.json')
  saveContractToFile(deploymentResult.versionRegistryAddress, workdir, 'VersionRegistry.json')
}

export function showDeployment (deploymentResult: DeploymentResult, title: string | undefined, paymasterTitle: string | undefined = undefined): void {
  if (title != null) {
    console.log(title)
  }
  console.log(`
  RelayHub: ${deploymentResult.relayHubAddress}
  StakeManager: ${deploymentResult.stakeManagerAddress}
  Penalizer: ${deploymentResult.penalizerAddress}
  VersionRegistry: ${deploymentResult.versionRegistryAddress}
  Forwarder: ${deploymentResult.forwarderAddress}
  Paymaster ${paymasterTitle != null ? '(' + paymasterTitle + ')' : ''}: ${deploymentResult.naivePaymasterAddress}`)
}

export function loadDeployment (workdir: string): DeploymentResult {
  function getAddress (name: string): string {
    return getAddressFromFile(path.join(workdir, name + '.json')) as string
  }

  return {
    relayHubAddress: getAddress('RelayHub'),
    stakeManagerAddress: getAddress('StakeManager'),
    penalizerAddress: getAddress('Penalizer'),
    forwarderAddress: getAddress('Forwarder'),
    versionRegistryAddress: getAddress('VersionRegistry'),
    naivePaymasterAddress: getAddress('Paymaster')
  }
}

type GsnOption = 'n' | 'f' | 'h' | 'm' | 'g'

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
        commander.option('-m, --mnemonic <mnemonic>', 'mnemonic file to generate private key for account \'from\' (default: empty)')
        break
      case 'g':
        commander.option('-g, --gasPrice <number>', 'gas price to give to the transaction. Defaults to 1 gwei.', '1000000000')
        break
    }
  })
  return commander
}
