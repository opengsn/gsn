import chalk from 'chalk'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import { DeploymentsExtension } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ethers } from 'hardhat'
import { formatEther } from 'ethers/lib/utils'

import { HttpNetworkConfig } from 'hardhat/src/types/config'

// TODO: extract duplicated code to utils
// helper: nicer logging view fo deployed contracts
async function deploy (deployments: DeploymentsExtension, name: string, options: DeployOptions): Promise<DeployResult> {
  console.log('Deploying: ', name)
  const res = await deployments.deploy(name, { ...options, log: true })
  console.log(name, res.address, res.newlyDeployed ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
  return res
}

// TODO: read from file by chainID
// these are hard-coded Goerli parameters
function tokenUniswapV3PermitPaymasterConstructorArgs (): any {
  const SWAP_ROUTER_CONTRACT_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
  const WETH9_CONTRACT_ADDRESS = '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6'
  const DAI_CONTRACT_ADDRESS = '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844'
  const CHAINLINK = '0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e'
  const PERMIT_SIGNATURE_DAI = 'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'
  const SLIPPAGE = 10

  const uniswapConfig = {
    uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
    weth: WETH9_CONTRACT_ADDRESS,
    minSwapAmount: 0,
    tokens: [DAI_CONTRACT_ADDRESS],
    priceFeeds: [CHAINLINK],
    uniswapPoolFees: [3000],
    permitMethodSignatures: [PERMIT_SIGNATURE_DAI],
    slippages: [SLIPPAGE],
    reverseQuotes: [true]
  }

  const GAS_USED_BY_POST = 230000
  const MIN_HUB_BALANCE = 1e17.toString()
  const TARGET_HUB_BALANCE = 1e18.toString()
  const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()

  const gasAndEthConfig = {
    gasUsedByPost: GAS_USED_BY_POST,
    minHubBalance: MIN_HUB_BALANCE,
    targetHubBalance: TARGET_HUB_BALANCE,
    minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
    paymasterFee: 5
  }

  const GSN_FORWARDER_CONTRACT_ADDRESS = '0xAa3E82b4c4093b4bA13Cb5714382C99ADBf750cA'

  const GSN_HUB_CONTRACT_ADDRESS = '0x7DDa9Bf2C0602a96c06FA5996F715C7Acfb8E7b0'
  return [uniswapConfig, gasAndEthConfig, GSN_FORWARDER_CONTRACT_ADDRESS, GSN_HUB_CONTRACT_ADDRESS]
}

export default async function deploymentFunc (hre: HardhatRuntimeEnvironment): Promise<void> {
  console.log('Connected to URL: ', (hre.network.config as HttpNetworkConfig).url)
  const deployments = await hre.deployments
  const accounts = await hre.ethers.provider.listAccounts()
  const deployer = accounts[0]
  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', formatEther(balance.toString()))

  const paymasterName = 'PermitERC20UniswapV3Paymaster'
  await deploy(deployments, paymasterName, {
    from: deployer,
    args: tokenUniswapV3PermitPaymasterConstructorArgs()
  })

  // const paymasterBalance = await deployments.read(paymasterName, 'balanceOf', deployedPm.address)
  // console.log('current paymaster balance=', formatEther(paymasterBalance))
  // const depositValue = parseEther(env.deploymentConfiguration.paymasterDeposit)

  // if (paymasterBalance.toString() === '0') {
  //   console.log('depositing in paymaster', formatEther(depositValue))
  //   await deployments.execute(hubContractName, {
  //     from: deployer,
  //     value: depositValue,
  //     log: true
  //   }, 'depositFor', deployedPm.address)
  // }
}
