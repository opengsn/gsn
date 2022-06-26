import { DeploymentsExtension } from 'hardhat-deploy/types'

import { constants, GsnDomainSeparatorType, GsnRequestType } from '@opengsn/common'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ethers } from 'hardhat'

import {
  applyDeploymentConfig,
  fatal, getDeploymentEnv,
  printRelayInfo,
  setField
} from '../src/deployUtils'

const { AddressZero } = ethers.constants

// helper: nicer logging view fo deployed contracts
async function deploy (deployments: DeploymentsExtension, name: string, options: DeployOptions): Promise<DeployResult> {
  console.log('Deploying: ', name)
  const res = await deployments.deploy(name, { ...options, log: true })
  console.log(name, res.address, res.newlyDeployed ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
  return res
}

export default async function deploymentFunc (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { env, deployments, deployer } = await getDeploymentEnv(hre)

  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', formatEther(balance.toString()))

  if (env.deploymentConfiguration == null || Object.keys(env.deploymentConfiguration.minimumStakePerToken).length === 0) {
    fatal('must have at least one entry in minimumStakePerToken')
  }

  if (env.deploymentConfiguration?.isArbitrum ?? false) {
    // sanity: verify we indeed on arbitrum-enabled network.
    const ArbSys = new ethers.Contract(constants.ARBITRUM_ARBSYS, ['function arbOSVersion() external pure returns (uint)'], ethers.provider)
    await ArbSys.arbOSVersion()
  }

  let stakingTokenAddress = Object.keys(env.deploymentConfiguration.minimumStakePerToken ?? {})[0]
  if (stakingTokenAddress == null) {
    fatal('must specify token address in minimumStakePerToken (or "test" to deploy WrappedEthToken')
  }

  if (stakingTokenAddress === 'test') {
    const WrappedEthToken = await deploy(deployments, 'WrappedEthToken', {
      from: deployer
    })
    stakingTokenAddress = WrappedEthToken.address
  }

  const deployedForwarder = await deploy(deployments, 'Forwarder', {
    from: deployer,
    deterministicDeployment: true
  })

  if (deployedForwarder.newlyDeployed) {
    const options = { from: deployer, log: true }
    await deployments.execute('Forwarder', options, 'registerRequestType', GsnRequestType.typeName, GsnRequestType.typeSuffix)
    await deployments.execute('Forwarder', options, 'registerDomainSeparator', GsnDomainSeparatorType.name, GsnDomainSeparatorType.version)
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
    from: deployer,
    args: [env.deploymentConfiguration.registrationMaxAge]
  })

  const hubConfig = env.relayHubConfiguration
  let relayHub: DeployResult
  let hubContractName: string
  if (env.deploymentConfiguration?.isArbitrum ?? false) {
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

  await applyDeploymentConfig(hre)

  let deployedPm: DeployResult
  if (env.deploymentConfiguration.deployTestPaymaster) {
    deployedPm = await deploy(deployments, 'TestPaymasterEverythingAccepted', { from: deployer, log: true })

    await setField(deployments, 'TestPaymasterEverythingAccepted', 'getRelayHub', 'setRelayHub', relayHub.address, deployer)
    await setField(deployments, 'TestPaymasterEverythingAccepted', 'getTrustedForwarder', 'setTrustedForwarder', deployedForwarder.address, deployer)

    const paymasterBalance = await deployments.read(hubContractName, 'balanceOf', deployedPm.address)
    console.log('current paymaster balance=', formatEther(paymasterBalance))
    const depositValue = parseEther(env.deploymentConfiguration.paymasterDeposit)

    if (paymasterBalance.toString() === '0') {
      console.log('depositing in paymaster', formatEther(depositValue))
      await deployments.execute(hubContractName, {
        from: deployer,
        value: depositValue,
        log: true
      }, 'depositFor', deployedPm.address)
    }
  }

  await printRelayInfo(hre)
}
