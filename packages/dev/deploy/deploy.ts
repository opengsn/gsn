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
import { formatEther, formatUnits, parseEther, parseUnits } from 'ethers/lib/utils'
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

interface Token {
  address: string
  symbol: string
  decimals: number

  balanceOf: (address: string) => Promise<string>
}

async function getToken (address: string): Promise<Token> {
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

function printSampleEnvironment (defaultDevAddress: string, chainId: number): void {
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

function getMergedEnvironment (chainId: number, defaultDevAddress: string): Environment {
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

export default async function deploymentFunc (this: DeployFunction, hre: HardhatRuntimeEnvironment): Promise<void> {
  const { web3, deployments, getChainId } = hre
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', formatEther(balance.toString()))

  const chainId = parseInt(await getChainId())

  const env: Environment = getMergedEnvironment(chainId, deployer)

  if (env.deploymentConfiguration == null || Object.keys(env.deploymentConfiguration.minimumStakePerToken).length === 0) {
    fatal('must have at least one entry in minimumStakePerToken')
  }

  if (env.deploymentConfiguration.isArbitrum === true) {
    // sanity: verify we indeed on arbitrum-enabled network.
    const ArbSys = new ethers.Contract(constants.ARBITRUM_ARBSYS, ['function arbOSVersion() external pure returns (uint)'], ethers.provider)
    await ArbSys.arbOSVersion()
  }

  let stakingTokenAddress = Object.keys(env.deploymentConfiguration.minimumStakePerToken ?? {})[0]
  if (stakingTokenAddress == null) {
    fatal('must specify token address in minimumStakePerToken (or "test" to deploy WrappedEthToken')
  }

  let stakingTokenValue = env.deploymentConfiguration.minimumStakePerToken[stakingTokenAddress]

  if (stakingTokenAddress === 'test') {
    const WrappedEthToken = await deploy(deployments, 'WrappedEthToken', {
      from: deployer
    })
    stakingTokenAddress = WrappedEthToken.address
    stakingTokenValue = stakingTokenValue ?? '0.1'
  }

  // const token = await getToken(stakingTokenAddress)

  // const stakingTokenValueParsed = parseUnits(stakingTokenValue, token.decimals)
  // console.log('stakingTokenValueParsed', stakingTokenValueParsed.toString())

  // can't set "deterministicDeployment" on networks that require EIP-155 transactions (e.g. avax)
  const deterministicDeployment = false
  const deployedForwarder = await deploy(deployments, 'Forwarder', { from: deployer, deterministicDeployment })

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
  if (env.deploymentConfiguration.isArbitrum === true) {
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

  const tokens: Array<{ token: string, minimumStake: string } | null> = await Promise.all(
    Object.entries(env.deploymentConfiguration.minimumStakePerToken).map(async ([tokenAddr, configMinimumStake]) => {
      if (tokenAddr === 'test') {
        tokenAddr = stakingTokenAddress
      }
      const token = await getToken(tokenAddr)
      const minStake = await hub.getMinimumStakePerToken(tokenAddr)
      const parsedConfigMinimumStake = parseUnits(configMinimumStake, token.decimals).toString()
      console.log(`- Staking Token "${token.symbol}" ${token.address} current ${formatUnits(minStake, token.decimals)} config ${configMinimumStake}`)
      if (parsedConfigMinimumStake !== minStake.toString()) {
        return { token: tokenAddr, minimumStake: parsedConfigMinimumStake }
      } else {
        return null
      }
    })).then(list => list.filter(x => x != null))

  if (tokens.length !== 0) {
    console.log('Adding/Updating token stakes', tokens)
    await hub.setMinimumStakes(tokens.map(x => x?.token), tokens.map(x => x?.minimumStake))
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
  const network = hre.network.config as HttpNetworkConfig
  console.log(chalk.white('relayer config:'))
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
  console.log(chalk.white('relayer register:'))
  console.log(chalk.grey(`gsn relayer-register -m $SECRET --network ${network.url} --relayUrl https://${hre.hardhatArguments.network}.v3.opengsn.org/v3 --token ${stakingTokenAddress} --stake ${stakingTokenValue} --wrap`))
}
