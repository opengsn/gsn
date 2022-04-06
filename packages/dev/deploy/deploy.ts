import { DeployFunction } from 'hardhat-deploy/types'

import {
  defaultEnvironment, Environment,
  environments,
  EnvironmentsKeys, merge
} from '@opengsn/common'
import { constants } from '@opengsn/common/dist/Constants'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
// @ts-ignore
import { ethers } from 'hardhat'
import path from 'path'
import fs from 'fs'
import * as util from 'util'

const { AddressZero } = ethers.constants

const deploymentConfigFile = path.resolve(__dirname, '..', 'deployment-config.ts')

interface DeploymentConfig {
  [key: number]: Environment
}

const deploymentFunc: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const deployTestPaymaster = true

  // TODO: there should be type extensions to support these...
  const { web3, deployments, getChainId } = hre as any
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  // helper: nicer logging view fo deployed contracts
  async function deploy (name: string, options: DeployOptions): Promise<DeployResult> {
    console.log('Deploying: ', name)
    const res = await deployments.deploy(name, options)
    console.log(name, res.address, res.newlyDeployed as boolean ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
    return res
  }

  // helper: set a field on a contract only if it was changed.
  // the "deploy" mechanism has the property of "re-deploy only on change". this method replicate the logic for calling a setter.
  // @param contract - a contract deployed earlier using "deploy"
  // @param getFunc - a getter (with no params) to read current value
  // @param setFunc - a setter function (accepting a single value) to set the new value
  // @param val - the value we want the field to have
  // @param options - "execute" options
  const setField = async function (contract: string, getFunc: string, setFunc: string, val: any, options = {
    from: deployer,
    log: true
  }): Promise<void> {
    const currentVal = await deployments.read(contract, options, getFunc)
    if (currentVal !== val) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      console.log('calling', `${contract}.${setFunc}( ${val.toString()} )`)
      await deployments.execute(contract, options, setFunc, val)
    }
  }

  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', formatEther(balance.toString()))
  // if (balance.isZero()) {
  //   console.error(chalk.red(`deployer account ${deployer as string} doesn't have eth balance ${balance.toString()}`))
  //   process.exit(1)
  // }

  let isArbitrum = false
  try {
    const arbSysAddress = '0x' + '64'.padStart(40, '0')
    const ArbSys = new ethers.Contract(arbSysAddress, ['function arbOSVersion() external pure returns (uint)'], ethers.provider)
    const arbos = await ArbSys.arbOSVersion()

    console.log('== Running on', chalk.yellowBright('Arbitrum'), 'arbOSVersion=', arbos)
    isArbitrum = true
  } catch (e) {
  }

  function fatal (...params: any): never {
    console.error(chalk.red('fatal:'), ...params)
    process.exit(1)
  }

  const chainId = parseInt(await getChainId())

  let env: Environment
  try {
    const envname = Object.keys(environments).find(env => environments[env as EnvironmentsKeys].chainId === chainId)
    console.log('loading env ( based on chainId', chainId, ')', envname ?? 'DefaultEnvironment')
    const defaultEnv = envname != null ? environments[envname as EnvironmentsKeys] : defaultEnvironment
    let config: any
    if (fs.existsSync(deploymentConfigFile)) {
      const fileConfig = require(deploymentConfigFile) as DeploymentConfig
      config = fileConfig[chainId]
    }
    if (config == null) {
      const sampleEnv = merge(defaultEnv, {
        deploymentConfiguration: {
          paymasterDeposit: '0.1',
          minimumStakePerToken: { test: '0.5' }
        }
      })
      console.log(chalk.red('No configuration found:'), '\nPlease add the following to', chalk.whiteBright(`"${deploymentConfigFile}"`), ':\n\nmodule.exports = ',
        util.inspect({ [chainId]: sampleEnv }, false, 10, false))
      process.exit(1)
    } else {
      env = merge(defaultEnv, config)
    }
  } catch (e: any) {
    fatal(`Error reading config file ${deploymentConfigFile}: ${(e as Error).message}`)
  }

  if (env.deploymentConfiguration == null || Object.keys(env.deploymentConfiguration.minimumStakePerToken).length === 0) {
    fatal('must have at least one entry in minimumStakePerToken')
  }

  let stakingTokenAddress = Object.keys(env.deploymentConfiguration.minimumStakePerToken ?? {})[0]
  if (stakingTokenAddress == null) {
    fatal('must specify token address in minimumStakePerToken (or "test" to deploy TestWeth')
  }
  let stakingTokenValue = env.deploymentConfiguration.minimumStakePerToken[stakingTokenAddress]

  if (stakingTokenAddress === 'test') {
    const TestWEth = await deploy('TestWEth', {
      from: deployer
    })
    stakingTokenAddress = TestWEth.address
    stakingTokenValue = stakingTokenValue ?? '0.1'
  } else {
    const token = new ethers.Contract(stakingTokenAddress,
      ['function symbol() view returns (string)'], ethers.provider)
    // verify token address is a valid token...
    const symbol = await token.symbol().catch((e: any) => null)
    if (symbol == null) throw new Error(`invalid token: ${stakingTokenAddress}`)
    console.log('Using token', symbol, 'at', stakingTokenAddress, 'with minimum stake of', stakingTokenValue)
  }

  const deployedForwarder = await deploy('Forwarder', { from: deployer })

  if (deployedForwarder.newlyDeployed) {
    const f = new web3.eth.Contract(deployedForwarder.abi, deployedForwarder.address)
    await registerForwarderForGsn(f, {
      from: deployer
    })
  }

  const penalizer = await deploy('Penalizer', {
    from: deployer,
    args: [
      env.penalizerConfiguration.penalizeBlockDelay,
      env.penalizerConfiguration.penalizeBlockDelay
    ]
  })

  const stakeManager = await deploy('StakeManager', {
    from: deployer,
    args: [env.maxUnstakeDelay, env.abandonmentDelay, env.escheatmentDelay, constants.BURN_ADDRESS, env.relayHubConfiguration.devAddress]
  })

  const relayRegistrar = await deploy('RelayRegistrar', {
    from: deployer
  })

  const hubConfig = env.relayHubConfiguration
  let relayHub: DeployResult
  let hubContractName: string
  if (isArbitrum) {
    console.log(`Using ${chalk.yellow('Arbitrum')} relayhub`)
    hubContractName = 'ArbRelayHub'
    relayHub = await deploy(hubContractName, {
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
    relayHub = await deploy(hubContractName, {
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
    await hub.setMinimumStakes([stakingTokenAddress], [parseEther(stakingTokenValue)])
  }

  let deployedPm: DeployResult
  if (deployTestPaymaster) {
    deployedPm = await deploy('TestPaymasterEverythingAccepted', { from: deployer, log: true })

    await setField('TestPaymasterEverythingAccepted', 'getRelayHub', 'setRelayHub', relayHub.address)
    await setField('TestPaymasterEverythingAccepted', 'getTrustedForwarder', 'setTrustedForwarder', deployedForwarder.address)

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

export default deploymentFunc
