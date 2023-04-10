import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'

import chalk from 'chalk'
import path from 'path'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import { DeploymentsExtension } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { HttpNetworkConfig } from 'hardhat/src/types/config'
import { ethers } from 'hardhat'
import { formatEther } from 'ethers/lib/utils'

import { Address, PaymasterType } from '@opengsn/common'

// TODO: extract duplicated code to utils
// helper: nicer logging view fo deployed contracts
async function deploy (deployments: DeploymentsExtension, name: string, options: DeployOptions): Promise<DeployResult> {
  console.log('Deploying: ', name)
  const res = await deployments.deploy(name, { ...options, log: true })
  console.log(name, res.address, res.newlyDeployed ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
  return res
}

export function deploymentConfigFile (): string {
  return process.env.DEPLOY_CONFIG ?? path.resolve(__dirname, '../deployments', 'deployment-config.ts')
}

interface PaymasterDeploymentConfig {
  [key: number]: {
    PermitERC20UniswapV3Paymaster: {
      tokens: Array<{
        name: string
        slippage: string
        tokenAddress: string
        priceFeed: string
        uniswapPoolFee: string
        permitMethodSignature: string
        reverseQuote: boolean
      }>
      SLIPPAGE: string
      MIN_SWAP_AMOUNT: string
      SWAP_ROUTER_CONTRACT_ADDRESS: string
      WETH9_CONTRACT_ADDRESS: string
      DAI_CONTRACT_ADDRESS: string
      CHAINLINK: string
      PERMIT_SIGNATURE_DAI: string
      GAS_USED_BY_POST: string
      MIN_HUB_BALANCE: string
      TARGET_HUB_BALANCE: string
      MIN_WITHDRAWAL_AMOUNT: string
      GSN_FORWARDER_CONTRACT_ADDRESS: string
      GSN_HUB_CONTRACT_ADDRESS: string
    }
  }
}

function getPermitERC20UniswapV3PaymasterConstructorArgs (chainId: number): any[] {
  const allConfigurations = require(deploymentConfigFile()) as PaymasterDeploymentConfig
  const config = allConfigurations[chainId]?.PermitERC20UniswapV3Paymaster
  if (config == null) {
    throw new Error(`Could not find config for chainID ${chainId}`)
  }

  const uniswapConfig = {
    uniswap: config.SWAP_ROUTER_CONTRACT_ADDRESS,
    weth: config.WETH9_CONTRACT_ADDRESS,
    minSwapAmount: config.MIN_SWAP_AMOUNT,
    tokens: config.tokens.map(it => it.tokenAddress),
    priceFeeds: config.tokens.map(it => it.priceFeed),
    uniswapPoolFees: config.tokens.map(it => it.uniswapPoolFee),
    permitMethodSignatures: config.tokens.map(it => it.permitMethodSignature),
    slippages: config.tokens.map(it => it.slippage),
    reverseQuotes: config.tokens.map(it => it.reverseQuote)
  }

  const gasAndEthConfig = {
    gasUsedByPost: config.GAS_USED_BY_POST,
    minHubBalance: config.MIN_HUB_BALANCE,
    targetHubBalance: config.TARGET_HUB_BALANCE,
    minWithdrawalAmount: config.MIN_WITHDRAWAL_AMOUNT,
    paymasterFee: 5
  }

  return [uniswapConfig, gasAndEthConfig, config.GSN_FORWARDER_CONTRACT_ADDRESS, config.GSN_HUB_CONTRACT_ADDRESS]
}

export default async function deploymentFunc (hre: HardhatRuntimeEnvironment): Promise<void> {
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const deployments = await hre.deployments
  const accounts = await hre.ethers.provider.listAccounts()
  const deployer = accounts[0]
  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', formatEther(balance.toString()))
  const paymasterToDeploy = process.env.PAYMASTER_TO_DEPLOY
  const chainId = parseInt(await hre.getChainId())
  switch (paymasterToDeploy) {
    case PaymasterType.PermitERC20UniswapV3Paymaster:
      await deployPermitERC20UniswapV3Paymaster(deployments, deployer, chainId)
      break
    case PaymasterType.SingletonWhitelistPaymaster:
      await deploySingletonWhitelistPaymaster(deployments, deployer, chainId)
      break
    default:
      throw new Error(`Unknown PAYMASTER_TO_DEPLOY env variable: ${paymasterToDeploy}`)
  }
}

async function deployPermitERC20UniswapV3Paymaster (
  deployments: DeploymentsExtension,
  deployer: Address,
  chainId: number
): Promise<void> {
  const paymasterName = 'PermitERC20UniswapV3Paymaster'
  const args = getPermitERC20UniswapV3PaymasterConstructorArgs(chainId)
  console.log('Will deploy PermitERC20UniswapV3Paymaster with the following configuration:\n', JSON.stringify(args))
  const deployedPm = await deploy(deployments, paymasterName, {
    from: deployer,
    args
  })

  // TODO: named parameters to avoid reference by index
  console.log(`Reading Paymaster balance on RelayHub at ${args[3] as string}`)
  const hub = await ethers.getContractAt('RelayHub', args[3])
  const paymasterBalance = await hub.balanceOf(deployedPm.address)
  console.log('current paymaster balance=', formatEther(paymasterBalance))
  // TODO: support depositing based on paymaster type
}

async function deploySingletonWhitelistPaymaster (
  deployments: DeploymentsExtension,
  deployer: Address,
  chainId: number
): Promise<void> {
  // TODO: Hub and Forwarder address are shared across Paymasters - refactor
  const allConfigurations = require(deploymentConfigFile()) as PaymasterDeploymentConfig
  const config = allConfigurations[chainId]?.PermitERC20UniswapV3Paymaster
  console.log('Will deploy SingletonWhitelistPaymaster')
  const paymasterName = 'SingletonWhitelistPaymaster'
  await deploy(deployments, paymasterName, {
    from: deployer
  })
  // TODO: read it from the file!
  await deployments.execute(
    paymasterName,
    { from: deployer, log: true },
    'setSharedConfiguration',
    30000,
    15
  )
  await deployments.execute(
    paymasterName,
    { from: deployer, log: true },
    'setRelayHub',
    config.GSN_HUB_CONTRACT_ADDRESS
  )
  await deployments.execute(
    paymasterName,
    { from: deployer, log: true },
    'setTrustedForwarder',
    config.GSN_FORWARDER_CONTRACT_ADDRESS
  )
}
