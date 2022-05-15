import { DeployFunction, DeploymentsExtension, TxOptions } from 'hardhat-deploy/types'
import { HttpNetworkConfig } from 'hardhat/src/types/config'

import { Environment } from '@opengsn/common'
import { constants } from '@opengsn/common/dist/Constants'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'
import { formatEther, formatUnits, parseEther, parseUnits } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ethers } from 'hardhat'
import { fatal, getMergedEnvironment, getToken, printRelayInfo, setField } from '../src/deployUtils'
import { Contract } from "ethers";

const { AddressZero } = ethers.constants

// helper: nicer logging view fo deployed contracts
async function deploy (deployments: DeploymentsExtension, name: string, options: DeployOptions): Promise<DeployResult> {
  console.log('Deploying: ', name)
  const res = await deployments.deploy(name, options)
  console.log(name, res.address, res.newlyDeployed ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
  return res
}

//check if token's minimum stake is correct. return null if no need to change.
async function updateTokenStakeOrNull (hub: Contract, tokenAddr: string, configMinimumStake: string): Promise<{ token: string, minimumStake: string } | null> {
  const token = await getToken(tokenAddr)
  const minStake = await hub.getMinimumStakePerToken(tokenAddr)
  const parsedConfigMinimumStake = parseUnits(configMinimumStake, token.decimals).toString()
  console.log(`- Staking Token "${token.symbol}" ${token.address} current ${formatUnits(minStake, token.decimals)} config ${configMinimumStake}`)
  if (parsedConfigMinimumStake !== minStake.toString()) {
    return { token: tokenAddr, minimumStake: parsedConfigMinimumStake }
  } else {
    return null
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

  if (env.deploymentConfiguration?.isArbitrum ?? false) {
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

  // can't set "deterministicDeployment" on networks that require EIP-155 transactions (e.g. avax)
  const deployedForwarder = await deploy(deployments, 'Forwarder', {
    from: deployer,
    deterministicDeployment: true
  }).catch(async e => {
    console.log('re-attempting to deploy forwarder using non-deterministic address')
    return await deploy(deployments, 'Forwarder', { from: deployer, deterministicDeployment: false })
  })

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
  const hub = new ethers.Contract(relayHub.address, relayHub.abi, ethers.provider.getSigner())

  const configChanges = Object.entries(env.deploymentConfiguration.minimumStakePerToken).map(async ([tokenAddr, configMinimumStake]) =>
    updateTokenStakeOrNull(hub, tokenAddr === 'test' ? stakingTokenAddress : tokenAddr, configMinimumStake))
    .filter(x => x != null)

  const tokens = await Promise.all(configChanges)

  if (tokens.length !== 0) {
    console.log('Adding/Updating token stakes', tokens)
    const ret = await hub.setMinimumStakes(tokens.map(x => x?.token), tokens.map(x => x?.minimumStake))
    await ret.wait()
  }

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
