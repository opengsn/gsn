import { DeployFunction } from 'hardhat-deploy/types'
import {
  ConstructorParams,
  ContractInteractor,
  defaultEnvironment,
  environments,
  EnvironmentsKeys,
  VersionRegistry
} from '@opengsn/common'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
// @ts-ignore
import { deployments, ethers } from 'hardhat'

const deploymentFunc: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {

  const deployRegistrar = true
  const useVersionRegistry = false
  const deployTestPaymaster = true

  // TODO: there should be type extensions to support these...
  const { web3, deployments, getChainId } = hre as any
  const accounts = await ethers.provider.listAccounts()
  const deployer = accounts[0]

  async function deploy (name: string, options: DeployOptions): Promise<DeployResult> {
    console.log('Deploying: ', name)
    const res = await deployments.deploy(name, options)
    console.log(name, res.address, res.newlyDeployed ? chalk.yellow('newlyDeployed') : chalk.gray('existing'))
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
  env.relayHubConfiguration.minimumStake = parseEther('0.01').toString()

  const isUsingRegistryStorage: boolean = (process.env.USE_STORAGE ?? 'true').match(/^[t1y]/i) != null

  console.log('isUsingRegistryStorage=', isUsingRegistryStorage, '(set with', chalk.yellow('USE_STORAGE'), ')')

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
    args: [env.maxUnstakeDelay]
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
        '0x0000000000000000000000000000000000000064',
        stakeManager.address,
        penalizer.address,
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
        hubConfig
      ]
    })
  }

  if (deployRegistrar) {
    const relayRegistrar = await deploy('RelayRegistrar', {
      from: deployer,
      args: [relayHub.address, isUsingRegistryStorage]
    })

    const hub = new ethers.Contract(relayHub.address, relayHub.abi, ethers.provider.getSigner())
    const currentRegistrar = await hub.relayRegistrar() as string
    if (currentRegistrar !== relayRegistrar.address) {
      if (currentRegistrar !== ethers.constants.AddressZero) {
        console.error(chalk.red(`fatal: unable to modify registrar in hub. currently set: ${currentRegistrar}`))
      } else {
        const ret = await hub.setRegistrar(relayRegistrar.address)
        await ret.wait()
      }
    }
  }

  if (useVersionRegistry) {
    const versionRegistry = await deploy('VersionRegistry', {
      from: deployer
    })

    if (versionRegistry.newlyDeployed || relayHub.newlyDeployed) {
      const versionRegistryAddress = versionRegistry.address
      const params: ConstructorParams = {
        provider: web3.currentProvider,
        environment: env,
        maxPageSize: -1,
        logger: console,
        deployment: { versionRegistryAddress }
      }
      const contractInteractor = await new ContractInteractor(params).init()
      // @ts-ignore
      const reg = new VersionRegistry(versionRegistry.receipt.blockNumber, contractInteractor)
      // version is unique string for this hub deployment
      const ver = await ethers.provider.getBlockNumber()
      await reg.addVersion('hub', ver.toString(), relayHub.address, { from: deployer })
    }
  }

  let deployedPm: DeployResult
  if (deployTestPaymaster) {
    deployedPm = await deploy('TestPaymasterEverythingAccepted', { from: deployer, log: true })

    await setField('TestPaymasterEverythingAccepted', 'getHubAddr', 'setRelayHub', relayHub.address)
    await setField('TestPaymasterEverythingAccepted', 'trustedForwarder', 'setTrustedForwarder', deployedForwarder.address)

    const val = await deployments.read(hubContractName, 'balanceOf', deployedPm.address)
    console.log('current balance=', val.toString())
    const depositValue = parseEther('0.01')

    if (val.toString() === '0') {
      await deployments.execute(hubContractName, {
        from: deployer,
        value: depositValue,
        log: true
      }, 'depositFor', deployedPm.address)
    }
  }
}

export default deploymentFunc
