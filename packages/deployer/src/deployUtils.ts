import chalk from 'chalk'
import * as util from 'util'
import path from 'path'
import fs from 'fs'
import {
  DeploymentConfiguration,
  Environment,
  environments,
  EnvironmentsKeys,
  isSameAddress,
  merge
} from '@opengsn/common'
import { ethers } from 'hardhat'
import { DeploymentsExtension, TxOptions } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { HttpNetworkConfig } from 'hardhat/src/types/config'
import { Contract } from 'ethers'
import { formatUnits, parseUnits } from 'ethers/lib/utils'

export function deploymentConfigFile (): string {
  return process.env.DEPLOY_CONFIG ?? path.resolve(__dirname, '../deployments', 'deployment-config.ts')
}

export interface DeploymentConfig {
  [key: number]: Environment
}

export function fatal (...params: any): never {
  console.error(chalk.red('fatal:'), ...params)
  process.exit(1)
}

export function getMergedEnvironment (chainId: number, defaultDevAddress: string): Environment {
  try {
    let config: Environment | undefined
    if (fs.existsSync(deploymentConfigFile())) {
      console.log('loading config file', deploymentConfigFile())
      const fileConfig = require(deploymentConfigFile()) as DeploymentConfig
      config = fileConfig[chainId]
    } else {
      console.log(chalk.red('Unable to read ', deploymentConfigFile()))
    }
    if (config == null) {
      printSampleEnvironment(defaultDevAddress, chainId)
      process.exit(1)
    }
    const env = environments[config?.environmentsKey]
    if (env == null) {
      fatal(`Environment with name ${config?.environmentsKey} not found`)
    }
    console.log('loading env', config.environmentsKey)
    return merge(env, config)
  } catch (e: any) {
    fatal(`Error reading config file ${deploymentConfigFile()}: ${(e as Error).message}`)
  }
}

export function printSampleEnvironment (defaultDevAddress: string, chainId: number): void {
  const deploymentConfiguration: DeploymentConfiguration = {
    registrationMaxAge: 180 * 24 * 3600,
    paymasterDeposit: '0.1',
    isArbitrum: false,
    deployTestPaymaster: true,
    deploySingleRecipientPaymaster: false,
    minimumStakePerToken: { test: '0.5' }
  }
  const sampleEnv = {
    environmentsKey: EnvironmentsKeys.ethereumMainnet,
    relayHubConfiguration: {
      devAddress: defaultDevAddress,
      devFee: 10
    },
    deploymentConfiguration
  }
  console.log(chalk.red('No configuration found:'), '\nPlease add the following to', chalk.whiteBright(`"${deploymentConfigFile()}"`), ':\n\nmodule.exports = ',
    util.inspect({ [chainId]: sampleEnv }, false, 10, false))
}

interface Token {
  address: string
  symbol: string
  decimals: number

  balanceOf: (address: string) => Promise<string>
}

export async function getToken (address: string): Promise<Token> {
  const token = new ethers.Contract(address,
    [
      'function symbol() view returns (string)',
      'function balanceOf() view returns (uint256)',
      'function decimals() view returns (uint256)'
    ], ethers.provider)
  // verify token address is a valid token...
  const symbol: string = await token.symbol().catch((e: any) => null)
  const decimals: number = await token.decimals().catch((e: any) => null)
  if (symbol == null || decimals == null) {
    throw new Error(`invalid token: ${address} (Symbol: ${symbol} Decimals: ${decimals})`)
  }
  const divisor = Math.pow(10, decimals)

  return {
    address,
    symbol,
    decimals,
    balanceOf: async (addr: string) => token.balanceOf(addr).then((v: any) => v.div(divisor))
  }
}

/** helper: set a field on a contract only if it was changed.
 * the "deploy" mechanism has the property of "re-deploy only on change". this method replicate the logic for calling a setter.
 * @param deployments - hardhat deploy extension
 * @param contract - a contract deployed earlier using "deploy"
 * @param getFunc - a getter (with no params) to read current value
 * @param setFunc - a setter function (accepting a single value) to set the new value
 * @param val - the value we want the field to have
 * @param deployer
 */
export async function setField (deployments: DeploymentsExtension, contract: string, getFunc: string, setFunc: string, val: string, deployer: string): Promise<void> {
  const options: TxOptions = {
    from: deployer,
    log: true
  }
  const currentVal = await deployments.read(contract, options, getFunc)
  if (currentVal.toString() !== val) {
    console.log('calling', `${contract}.${setFunc}( ${val} )`)
    await deployments.execute(contract, options, setFunc, val)
  }
}

async function getStakingInfo (hre: HardhatRuntimeEnvironment, env: Environment): Promise<{ stakingTokenAddress: string, stakingTokenValue: string }> {
  // @ts-ignore
  let stakingTokenAddress = Object.keys(env.deploymentConfiguration.minimumStakePerToken ?? {})[0]
  // @ts-ignore
  const stakingTokenValue = env.deploymentConfiguration.minimumStakePerToken[stakingTokenAddress]

  if (stakingTokenAddress === 'test') {
    stakingTokenAddress = await hre.deployments.get('TestWrappedNativeToken').then(res => res.address)
  }
  return { stakingTokenAddress, stakingTokenValue }
}

export async function printRelayInfo (hre: HardhatRuntimeEnvironment, isArbitrum: boolean = false): Promise<void> {
  const { getChainId } = hre
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  const chainId = parseInt(await getChainId())
  const env: Environment = getMergedEnvironment(chainId, deployer)

  const { stakingTokenAddress, stakingTokenValue } = await getStakingInfo(hre, env)

  const hub = await hre.deployments.get(isArbitrum ? 'ArbRelayHub' : 'RelayHub')
  const network = hre.network.config as HttpNetworkConfig
  console.log(chalk.white('Example for Relayer config JSON file:'))
  console.log(chalk.grey(JSON.stringify({
    relayHubAddress: hub.address,
    ownerAddress: deployer,
    managerStakeTokenAddress: stakingTokenAddress,
    gasPriceFactor: 1,
    maxFeePerGas: 1e12,
    ethereumNodeUrl: network.url
  }, null, 2)))
  console.log(chalk.white('Register your Relay Server:'))
  console.log(chalk.grey('Go to https://relays.opengsn.org/ and register your relay server with the web app, or use the following CLI command:'))
  console.log(chalk.grey(`gsn relayer-register -m $SECRET --network ${network.url} --relayUrl https://${hre.hardhatArguments.network}.v3.opengsn.org/v3 --token ${stakingTokenAddress} --stake ${stakingTokenValue} --wrap`))
}

export async function getDeploymentEnv (hre: HardhatRuntimeEnvironment): Promise<{ deployer: string, deployments: DeploymentsExtension, env: Environment }> {
  const { deployments, getChainId } = hre
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const accounts = await hre.ethers.provider.listAccounts()
  const deployer = accounts[0]
  const chainId = parseInt(await getChainId())
  const env: Environment = getMergedEnvironment(chainId, deployer)

  return {
    deployer,
    deployments,
    env
  }
}

// check if token's minimum stake is correct. return null if no need to change.
async function getTokenUpdateStakeOrNull (hub: Contract, tokenAddr: string, configMinimumStake: string): Promise<{ token: string, minimumStake: string } | null> {
  const token = await getToken(tokenAddr)
  const minStake = await hub.getMinimumStakePerToken(tokenAddr)
  const parsedConfigMinimumStake = parseUnits(configMinimumStake, token.decimals).toString()
  const modified = parsedConfigMinimumStake !== minStake.toString()
  console.log(`- Staking Token "${token.symbol}" ${token.address} current ${formatUnits(minStake, token.decimals)} config ${configMinimumStake}, ${modified ? '' : '(unchanged)'}`)
  if (modified) {
    return { token: tokenAddr, minimumStake: parsedConfigMinimumStake }
  } else {
    return null
  }
}

async function applyStakingTokenConfiguration (hre: HardhatRuntimeEnvironment, env: Environment, hub: Contract): Promise<void> {
  const deployments = await hre.deployments.all()
  const testStakingTokenAddress = deployments.TestWrappedNativeToken?.address

  const configChanges = await Promise.all(Object.entries(env.deploymentConfiguration?.minimumStakePerToken ?? [])
    .map(async ([tokenAddr, configMinimumStake]) =>
      await getTokenUpdateStakeOrNull(hub, tokenAddr === 'test' ? testStakingTokenAddress : tokenAddr, configMinimumStake)))

  const tokens = configChanges.filter(x => x != null)

  if (tokens.length !== 0) {
    console.log('Adding/Updating token stakes', tokens)
    const ret = await hub.setMinimumStakes(tokens.map(x => x?.token), tokens.map(x => x?.minimumStake))
    await ret.wait()
  }
}

// clean object values, so we can compare configuration to values we read from the chain
// - ignore numeric index
// - values are toString'ed (to unify number/BN/string) and lower-cased
function clean (obj: any): string {
  return JSON.stringify(Object.keys(obj)
    .sort()
    .filter(key => key.match(/^\d+$/) == null)
    .reduce((set, key) => ({
      [key]: obj[key].toString().toLowerCase(),
      ...set
    }), {}))
}

async function applyHubConfiguration (env: Environment, hub: Contract): Promise<void> {
  const currentConfig = clean(await hub.getConfiguration())
  const newConfig = clean(env.relayHubConfiguration)
  if (currentConfig === newConfig) {
    console.log('RelayHub: no configuration change')
  } else {
    console.log('RelayHub: apply new config', newConfig)
    await hub.setConfiguration(JSON.parse(newConfig))
    const updatedConfig = clean(await hub.getConfiguration())
    if (updatedConfig !== newConfig) {
      throw new Error(`FATAL: get/set configuration mismatch\nset=${newConfig}\nget=${updatedConfig}}`)
    }
  }
}

export async function applyDeploymentConfig (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, env, deployer } = await getDeploymentEnv(hre)

  const contracts = await deployments.all()
  const relayHub = contracts.RelayHub ?? contracts.ArbRelayHub
  const hub = new ethers.Contract(relayHub.address, relayHub.abi, ethers.provider.getSigner())

  await applyHubConfiguration(env, hub)
  await applyStakingTokenConfiguration(hre, env, hub)

  const { devAddress: stakeManagerDevAddress } = await deployments.read('StakeManager', 'getAbandonedRelayServerConfig')
  if (!isSameAddress(stakeManagerDevAddress, env.relayHubConfiguration.devAddress)) {
    console.log('StakeManager: update devAddress')
    await deployments.execute('StakeManager', { from: deployer }, 'setDevAddress', env.relayHubConfiguration.devAddress)
  }

  if (env.deploymentConfiguration == null) {
    throw new Error('deploymentConfiguration is null')
  }
  await setField(deployments, 'RelayRegistrar', 'getRelayRegistrationMaxAge', 'setRelayRegistrationMaxAge',
    env.deploymentConfiguration.registrationMaxAge.toString(), deployer)
}
