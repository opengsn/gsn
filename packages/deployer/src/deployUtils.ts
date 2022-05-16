import chalk from 'chalk'
import * as util from 'util'
import path from 'path'
import fs from 'fs'
import { defaultEnvironment, Environment, getEnvironment, merge } from '@opengsn/common'
import { ethers } from "hardhat";
import { DeploymentsExtension, TxOptions } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HttpNetworkConfig } from "hardhat/src/types/config";

export const deploymentConfigFile = path.resolve(__dirname, '../deployments', 'deployment-config.ts')

export interface DeploymentConfig {
  [key: number]: Environment
}

export function fatal (...params: any): never {
  console.error(chalk.red('fatal:'), ...params)
  process.exit(1)
}

export function getMergedEnvironment (chainId: number, defaultDevAddress: string): Environment {
  try {
    const env = getEnvironment(chainId) ?? { name: 'default', environment: defaultEnvironment }
    if (env == null) {
      fatal(`Environment with chainID ${chainId} not found`)
    }
    console.log('loading env ( based on chainId', chainId, ')', env.name)
    let config: any
    if (fs.existsSync(deploymentConfigFile)) {
      const fileConfig = require(deploymentConfigFile) as DeploymentConfig
      config = fileConfig[chainId]
    }
    if (config == null) {
      printSampleEnvironment(defaultDevAddress, chainId)
      process.exit(1)
    }

    return merge(env.environment, config)
  } catch (e: any) {
    fatal(`Error reading config file ${deploymentConfigFile}: ${(e as Error).message}`)
  }
}

export function printSampleEnvironment (defaultDevAddress: string, chainId: number): void {
  const sampleEnv = {
    relayHubConfiguration: {
      devAddress: defaultDevAddress
    },

    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      isArbitrum: false,
      deployTestPaymaster: true,
      minimumStakePerToken: { test: '0.5' }
    }
  }
  console.log(chalk.red('No configuration found:'), '\nPlease add the following to', chalk.whiteBright(`"${deploymentConfigFile}"`), ':\n\nmodule.exports = ',
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
  if (currentVal !== val) {
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
    stakingTokenAddress = await hre.deployments.get('WrappedEthToken').then(res => res.address)
  }
  return { stakingTokenAddress, stakingTokenValue }
}

export async function printRelayInfo (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { getChainId } = hre
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  const chainId = parseInt(await getChainId())
  const env: Environment = getMergedEnvironment(chainId, deployer)

  const { stakingTokenAddress, stakingTokenValue } = await getStakingInfo(hre, env)

  const hub = await hre.deployments.get('RelayHub')
  const network = hre.network.config as HttpNetworkConfig
  console.log(chalk.white('Example for Relayer config JSON file:'))
  console.log(chalk.grey(JSON.stringify({
    baseRelayFee: 0,
    pctRelayFee: 70,
    relayHubAddress: hub.address,
    ownerAddress: deployer,
    managerStakeTokenAddress: stakingTokenAddress,
    gasPriceFactor: 1,
    maxGasPrice: 1e12,
    ethereumNodeUrl: network.url
  }, null, 2)))
  console.log(chalk.white('Relayer register:'))
  console.log(chalk.grey(`gsn relayer-register -m $SECRET --network ${network.url} --relayUrl https://${hre.hardhatArguments.network}.v3.opengsn.org/v3 --token ${stakingTokenAddress} --stake ${stakingTokenValue} --wrap`))
}
