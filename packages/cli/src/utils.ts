// TODO: allow reading network URLs from 'truffle-config.js'
import commander, { CommanderStatic } from 'commander'
import fs from 'fs'
import path from 'path'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { RelayHubConfiguration } from '@opengsn/common/dist/types/RelayHubConfiguration'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'

const cliInfuraId = '$INFURA_ID'
export const networks = new Map<string, string>([
  ['localhost', 'http://127.0.0.1:8545'],
  ['xdai', 'https://dai.poa.network'],
  ['ropsten', 'https://ropsten.infura.io/v3/' + cliInfuraId],
  ['rinkeby', 'https://rinkeby.infura.io/v3/' + cliInfuraId],
  ['kovan', 'https://kovan.infura.io/v3/' + cliInfuraId],
  ['optimism_kovan', 'https://kovan.optimism.io/'],
  ['optimism', 'https://mainnet.optimism.io/'],
  ['goerli', 'https://goerli.infura.io/v3/' + cliInfuraId],
  ['mainnet', 'https://mainnet.infura.io/v3/' + cliInfuraId]
])

export const networksBlockExplorers = new Map<string, string>([
  ['xdai', 'https://blockscout.com/poa/xdai/'],
  ['ropsten', 'https://ropsten.etherscan.io/'],
  ['rinkeby', 'https://rinkeby.etherscan.io/'],
  ['kovan', 'https://kovan.etherscan.io/'],
  ['optimism_kovan', 'https://kovan-optimistic.etherscan.io/'],
  ['optimism', 'https://optimistic.etherscan.io/'],
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
  saveContractToFile(deploymentResult.versionRegistryAddress, workdir, 'VersionRegistry.json')
}

export function showDeployment (deploymentResult: GSNContractsDeployment, title: string | undefined, paymasterTitle: string | undefined = undefined): void {
  if (title != null) {
    console.log(title)
  }
  console.log(`
  RelayHub: ${deploymentResult.relayHubAddress}
  StakeManager: ${deploymentResult.stakeManagerAddress}
  Penalizer: ${deploymentResult.penalizerAddress}
  VersionRegistry: ${deploymentResult.versionRegistryAddress}
  Forwarder: ${deploymentResult.forwarderAddress}
  Paymaster ${paymasterTitle != null ? '(' + paymasterTitle + ')' : ''}: ${deploymentResult.paymasterAddress}`)
}

export function loadDeployment (workdir: string): GSNContractsDeployment {
  function getAddress (name: string): string {
    return getAddressFromFile(path.join(workdir, name + '.json')) as string
  }

  return {
    relayHubAddress: getAddress('RelayHub'),
    stakeManagerAddress: getAddress('StakeManager'),
    penalizerAddress: getAddress('Penalizer'),
    forwarderAddress: getAddress('Forwarder'),
    versionRegistryAddress: getAddress('VersionRegistry'),
    paymasterAddress: getAddress('Paymaster')
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
        commander.option('-m, --mnemonic <mnemonic>', 'mnemonic file to generate private key for account \'from\'')
        break
      case 'g':
        commander.option('-g, --gasPrice <number>', 'gas price to give to the transaction, in gwei.', '1')
        break
    }
  })
  commander.option('-l, --loglevel <string>', 'error | warn | info | debug', 'debug')
  return commander
}
