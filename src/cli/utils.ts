// TODO: allow reading network URLs from 'truffle-config.js'
import commander, { CommanderStatic } from 'commander'
import fs from 'fs'
import { Address } from '../relayclient/types/Aliases'
import path from 'path'
import { DeploymentResult } from './CommandsLogic'
import { RelayHubConfiguration } from '../relayclient/types/RelayHubConfiguration'

export const networks = new Map<string, string>([
  ['localhost', 'http://127.0.0.1:8545'],
  ['xdai', 'https://dai.poa.network'],
  ['ropsten', 'https://ropsten.infura.io/v3/c3422181d0594697a38defe7706a1e5b'],
  ['rinkeby', 'https://rinkeby.infura.io/v3/c3422181d0594697a38defe7706a1e5b'],
  ['kovan', 'https://kovan.infura.io/v3/c3422181d0594697a38defe7706a1e5b'],
  ['mainnet', 'https://mainnet.infura.io/v3/c3422181d0594697a38defe7706a1e5b']
])

export function supportedNetworks (): string[] {
  return Array.from(networks.keys())
}

export function getNetworkUrl (network = ''): string {
  const match = network.match(/^(https?:\/\/.*)/) ?? []
  return networks.get(network) ?? match[0]
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
}

export function showDeployment (deploymentResult: DeploymentResult, title: string | undefined, paymasterTitle: string | undefined = undefined): void {
  if (title != null) {
    console.log(title)
  }
  console.log(`
  RelayHub: ${deploymentResult.relayHubAddress}
  StakeManager: ${deploymentResult.stakeManagerAddress}
  Penalizer: ${deploymentResult.penalizerAddress}
  Forwarder: ${deploymentResult.forwarderAddress}
  Paymaster ${paymasterTitle != null ? '(' + paymasterTitle + ')' : ''}: ${deploymentResult.naivePaymasterAddress}`)
}

export function loadDeployment (workdir: string): DeploymentResult {
  function getAddress (name: string): string {
    const address = getAddressFromFile(path.join(workdir, name + '.json'))
    if (address != null) { return address }
    throw new Error('no address for ' + name)
  }

  return {
    relayHubAddress: getAddress('RelayHub'),
    stakeManagerAddress: getAddress('StakeManager'),
    penalizerAddress: getAddress('Penalizer.json'),
    forwarderAddress: getAddress('Forwarder.json'),
    naivePaymasterAddress: getAddress('Paymaster.json')
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
