import { DeployFunction, DeploymentsExtension, TxOptions } from 'hardhat-deploy/types'
import { HttpNetworkConfig } from 'hardhat/src/types/config'

import {
  defaultEnvironment,
  Environment,
  getEnvironment,
  merge
} from '@opengsn/common'
import { constants } from '@opengsn/common/dist/Constants'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'
import { formatEther, parseEther, parseUnits } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ethers } from 'hardhat'
import path from 'path'
import fs from 'fs'
import * as util from 'util'

const { AddressZero } = ethers.constants

const deploymentConfigFile = path.resolve(__dirname, '..', 'deployment-config.ts')

interface DeploymentConfig {
  [key: number]: Environment
}

function fatal (...params: any): never {
  console.error(chalk.red('fatal:'), ...params)
  process.exit(1)
}

// helper: nicer logging view fo deployed contracts
async function deploy (deployments: DeploymentsExtension, name: string, options: DeployOptions): Promise<DeployResult> {
  console.log('Deploying: ', name)
  const res = await deployments.deploy(name, options)
  console.log(name, res.address, res.newlyDeployed ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
  return res
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
async function setField (deployments: DeploymentsExtension, contract: string, getFunc: string, setFunc: string, val: string, deployer: string): Promise<void> {
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

function printSampleEnvironment (environment: Environment, chainId: number): void {
  const sampleEnv = merge(environment, {
    deploymentConfiguration: {
      paymasterDeposit: '0.1',
      deployTestPaymaster: true,
      minimumStakePerToken: { test: '0.5' }
    }
  })
  console.log(chalk.red('No configuration found:'), '\nPlease add the following to', chalk.whiteBright(`"${deploymentConfigFile}"`), ':\n\nmodule.exports = ',
    util.inspect({ [chainId]: sampleEnv }, false, 10, false))
}

function getMergedEnvironment (chainId: number): Environment {
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
      printSampleEnvironment(env.environment, chainId)
      process.exit(1)
    }

    return merge(env.environment, config)
  } catch (e: any) {
    fatal(`Error reading config file ${deploymentConfigFile}: ${(e as Error).message}`)
  }
}

export default async function deploymentFunc (this: DeployFunction, hre: HardhatRuntimeEnvironment): Promise<void> {
  const { web3, deployments, getChainId } = hre
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', formatEther(balance.toString()))

  const chainId = parseInt(await getChainId())

  const env: Environment = getMergedEnvironment(chainId)

  if (env.deploymentConfiguration == null || Object.keys(env.deploymentConfiguration.minimumStakePerToken).length === 0) {
    fatal('must have at least one entry in minimumStakePerToken')
  }

  if (env.deploymentConfiguration.isArbitrum) {
    // sanity: verify we indeed on arbitrum-enabled network.
    const ArbSys = new ethers.Contract(constants.ARBITRUM_ARBSYS, ['function arbOSVersion() external pure returns (uint)'], ethers.provider)
    await ArbSys.arbOSVersion()
  }

  let stakingTokenAddress = Object.keys(env.deploymentConfiguration.minimumStakePerToken ?? {})[0]
  if (stakingTokenAddress == null) {
    fatal('must specify token address in minimumStakePerToken (or "test" to deploy TestWeth')
  }

  let stakingTokenDecimals: number
  let stakingTokenValue = env.deploymentConfiguration.minimumStakePerToken[stakingTokenAddress]

  if (stakingTokenAddress === 'test') {
    stakingTokenDecimals = 18
    const TestWEth = await deploy(deployments, 'TestWEth', {
      from: deployer
    })
    stakingTokenAddress = TestWEth.address
    stakingTokenValue = stakingTokenValue ?? '0.1'
  } else {
    const token = new ethers.Contract(stakingTokenAddress,
      [
        'function symbol() view returns (string)',
        'function decimals() view returns (uint256)'
      ], ethers.provider)
    // verify token address is a valid token...
    const symbol: string = await token.symbol().catch((e: any) => null)
    stakingTokenDecimals = await token.decimals().catch((e: any) => null)
    if (symbol == null || stakingTokenDecimals == null) {
      throw new Error(`invalid token: ${stakingTokenAddress} (Symbol: ${symbol} Decimals: ${stakingTokenDecimals})`)
    }
    console.log('Using token', symbol, 'at', stakingTokenAddress, 'with minimum stake of', stakingTokenValue)
  }

  const stakingTokenValueParsed = parseUnits(stakingTokenValue, stakingTokenDecimals)
  console.log('stakingTokenValueParsed', stakingTokenValueParsed.toString())

  const deployedForwarder = await deploy(deployments, 'Forwarder', { from: deployer })

  if (deployedForwarder.newlyDeployed) {
    const f = new web3.eth.Contract(deployedForwarder.abi, deployedForwarder.address)
    await registerForwarderForGsn(f, {
      from: deployer
    })
  }

  const penalizer = await deploy(deployments, 'Penalizer', {
    from: deployer,
    args: [
      env.penalizerConfiguration.penalizeBlockDelay,
      env.penalizerConfiguration.penalizeBlockDelay
    ]
  })

  const stakeManager = await deploy(deployments, 'StakeManager', {
    from: deployer,
    args: [env.maxUnstakeDelay, env.abandonmentDelay, env.escheatmentDelay, constants.BURN_ADDRESS, env.relayHubConfiguration.devAddress]
  })

  const relayRegistrar = await deploy(deployments, 'RelayRegistrar', {
    from: deployer
  })

  const hubConfig = env.relayHubConfiguration
  let relayHub: DeployResult
  let hubContractName: string
  if (env.deploymentConfiguration.isArbitrum) {
    console.log(`Using ${chalk.yellow('Arbitrum')} relayhub`)
    hubContractName = 'ArbRelayHub'
    relayHub = await deploy(deployments, hubContractName, {
      from: deployer,
      args: [
        constants.ARBITRUM_ARBSYS, // ArbSys
        stakeManager.address,
        penalizer.address,
        AddressZero, // batch gateway
        relayRegistrar.address,
        hubConfig
      ]
    })
  } else {
    hubContractName = 'RelayHub'
    relayHub = await deploy(deployments, hubContractName, {
      from: deployer,
      args: [
        stakeManager.address,
        penalizer.address,
        AddressZero, // batch gateway
        relayRegistrar.address,
        hubConfig
      ]
    })
  }
  const hub = new ethers.Contract(relayHub.address, relayHub.abi, ethers.provider.getSigner())

  if (relayHub.newlyDeployed) {
    console.log('Adding stake token', stakingTokenAddress, 'stake=', stakingTokenValue)
    await hub.setMinimumStakes([stakingTokenAddress], [stakingTokenValueParsed.toString()])
  }

  let deployedPm: DeployResult
  if (env.deploymentConfiguration.deployTestPaymaster) {
    deployedPm = await deploy(deployments, 'TestPaymasterEverythingAccepted', { from: deployer, log: true })

    await setField(deployments, 'TestPaymasterEverythingAccepted', 'getRelayHub', 'setRelayHub', relayHub.address, deployer)
    await setField(deployments, 'TestPaymasterEverythingAccepted', 'getTrustedForwarder', 'setTrustedForwarder', deployedForwarder.address, deployer)

    const val = await deployments.read(hubContractName, 'balanceOf', deployedPm.address)
    console.log('current paymaster balance=', formatEther(val))
    const depositValue = parseEther(env.deploymentConfiguration.paymasterDeposit)

    if (val.toString() === '0') {
      console.log('depositing in paymaster', formatEther(depositValue))
      await deployments.execute(hubContractName, {
        from: deployer,
        value: depositValue,
        log: true
      }, 'depositFor', deployedPm.address)
    }
  }
}
