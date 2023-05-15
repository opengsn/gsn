import { DeploymentsExtension } from 'hardhat-deploy/types'

import { constants, GsnDomainSeparatorType, GsnRequestType } from '@opengsn/common'
import { defaultGsnConfig } from '@opengsn/provider'

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

const FORWARDER_FILE = '@opengsn/contracts/src/forwarder/Forwarder.sol:Forwarder'
const PENALIZER_FILE = '@opengsn/contracts/src/Penalizer.sol:Penalizer'
const STAKE_MANAGER_FILE = '@opengsn/contracts/src/StakeManager.sol:StakeManager'
const RELAY_REGISTRAR_FILE = '@opengsn/contracts/src/utils/RelayRegistrar.sol:RelayRegistrar'
const RELAY_HUB_FILE = '@opengsn/contracts/src/RelayHub.sol:RelayHub'
const ARB_RELAY_HUB_FILE = '@opengsn/contracts/src/arbitrum/ArbRelayHub.sol:ArbRelayHub'
const TEST_PAYMASTER_EVERYTHING_ACCEPTED_FILE = '@opengsn/contracts/src/test/TestPaymasterEverythingAccepted.sol:TestPaymasterEverythingAccepted'
const SINGLE_RECIPIENT_PAYMASTER_FILE = '@opengsn/contracts/src/paymasters/SingleRecipientPaymaster.sol:SingleRecipientPaymaster'

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
    fatal('must specify token address in minimumStakePerToken (or "test" to deploy TestWrappedNativeToken')
  }

  if (stakingTokenAddress === 'test') {
    const TestWrappedNativeToken = await deploy(deployments, 'TestWrappedNativeToken', {
      from: deployer
    })
    stakingTokenAddress = TestWrappedNativeToken.address
  }

  const deployedForwarder = await deploy(deployments, 'Forwarder', {
    contract: FORWARDER_FILE,
    from: deployer,
    deterministicDeployment: true
  })

  if (deployedForwarder.newlyDeployed) {
    const options = { from: deployer, log: true }
    await deployments.execute('Forwarder', options, 'registerRequestType', GsnRequestType.typeName, GsnRequestType.typeSuffix)
    await deployments.execute('Forwarder', options, 'registerDomainSeparator', defaultGsnConfig.domainSeparatorName, GsnDomainSeparatorType.version)
  }

  const penalizer = await deploy(deployments, 'Penalizer', {
    from: deployer,
    contract: PENALIZER_FILE,
    args: [
      env.penalizerConfiguration.penalizeBlockDelay,
      env.penalizerConfiguration.penalizeBlockDelay
    ]
  })

  const stakeManager = await deploy(deployments, 'StakeManager', {
    from: deployer,
    contract: STAKE_MANAGER_FILE,
    args: [env.maxUnstakeDelay, env.abandonmentDelay, env.escheatmentDelay, env.stakeBurnAddress, env.relayHubConfiguration.devAddress]
  })

  const relayRegistrar = await deploy(deployments, 'RelayRegistrar', {
    from: deployer,
    contract: RELAY_REGISTRAR_FILE,
    args: [env.deploymentConfiguration.registrationMaxAge]
  })

  const hubConfig = env.relayHubConfiguration
  let relayHub: DeployResult
  let hubContractName: string
  let hubContractFile: string
  if (env.deploymentConfiguration?.isArbitrum ?? false) {
    console.log(`Using ${chalk.yellow('Arbitrum')} relayhub`)
    hubContractName = 'ArbRelayHub'
    hubContractFile = ARB_RELAY_HUB_FILE
    relayHub = await deploy(deployments, hubContractName, {
      from: deployer,
      contract: hubContractFile,
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
    hubContractFile = RELAY_HUB_FILE
    relayHub = await deploy(deployments, hubContractName, {
      from: deployer,
      contract: hubContractFile,
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
  let paymasterContractName: string | undefined
  let paymasterContractFile: string | undefined
  if (env.deploymentConfiguration.deployTestPaymaster) {
    paymasterContractName = 'TestPaymasterEverythingAccepted'
    paymasterContractFile = TEST_PAYMASTER_EVERYTHING_ACCEPTED_FILE
  } else if (env.deploymentConfiguration.deploySingleRecipientPaymaster) {
    paymasterContractName = 'SingleRecipientPaymaster'
    paymasterContractFile = SINGLE_RECIPIENT_PAYMASTER_FILE
  }
  if (paymasterContractName != null) {
    deployedPm = await deploy(deployments, paymasterContractName, {
      from: deployer,
      contract: paymasterContractFile,
      log: true
    })

    await setField(deployments, paymasterContractName, 'getRelayHub', 'setRelayHub', relayHub.address, deployer)
    await setField(deployments, paymasterContractName, 'getTrustedForwarder', 'setTrustedForwarder', deployedForwarder.address, deployer)

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

  await printRelayInfo(hre, env.deploymentConfiguration?.isArbitrum)
}
