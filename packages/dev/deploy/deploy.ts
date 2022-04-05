import { DeployFunction } from 'hardhat-deploy/types'
import {
  defaultEnvironment,
  environments,
  EnvironmentsKeys
} from '@opengsn/common'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
// @ts-ignore
import { ethers } from 'hardhat'

const { AddressZero } = ethers.constants

const deploymentFunc: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const deployTestPaymaster = true

  // TODO: there should be type extensions to support these...
  const { web3, deployments, getChainId } = hre as any
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  async function deploy (name: string, options: DeployOptions): Promise<DeployResult> {
    console.log('Deploying: ', name)
    const res = await deployments.deploy(name, options)
    console.log(name, res.address, res.newlyDeployed as boolean ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
    return res
  }

  const setField = async function (contract: string, getFunc: string, setFunc: string, val: any, options = {
    from: deployer,
    log: true
  }): Promise<void> {
    const currentVal = await deployments.read(contract, options, getFunc)
    if (currentVal !== val) {
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

  const chainId = parseInt(await getChainId())

  const envname = Object.keys(environments).find(env => environments[env as EnvironmentsKeys].chainId === chainId)
  console.log('loading env ( based on chainId', chainId, ')', envname ?? 'DefaultEnvironment')
  const env = envname != null ? environments[envname as EnvironmentsKeys] : defaultEnvironment

  let stakingTokenAddress = process.env.TOKEN
  if (stakingTokenAddress == null) {
    console.error('must specify TOKEN address (or "test" to deploy TestWeth')
    process.exit(1)
  }
  let stakingTokenValue = process.env.TOKEN_STAKE

  if (stakingTokenAddress === 'test') {
    const TestWEth = await deploy('TestWEth', {
      from: deployer
    })
    stakingTokenAddress = TestWEth.address
    stakingTokenValue = stakingTokenValue ?? '0.1'
  } else {
    if (stakingTokenValue == null) {
      console.error('must specify TOKEN_STAKE for staking token')
      process.exit(1)
    }
    const token = new ethers.Contract(stakingTokenAddress,
      ['function symbol() view returns (string)'], ethers.provider)
    // verify token address is a valid token...
    const symbol = await token.symbol().catch((e: any) => null)
    if (symbol == null) throw new Error(`invalid token: ${stakingTokenAddress}`)
    console.log('using token', symbol)
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

  const burnAddress = '0x'.padEnd(42, 'f')
  const stakeManager = await deploy('StakeManager', {
    from: deployer,
    args: [env.maxUnstakeDelay, burnAddress]
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
        '0x0000000000000000000000000000000000000064', // ArbSys
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
    const depositValue = parseEther('0.01')

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
