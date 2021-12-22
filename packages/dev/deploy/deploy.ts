import { DeployFunction } from 'hardhat-deploy/types'
import {
  ConstructorParams,
  ContractInteractor,
  defaultEnvironment,
  environments,
  EnvironmentsKeys,
  VersionRegistry
} from '@opengsn/common'
import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { DeployOptions, DeployResult } from 'hardhat-deploy/dist/types'
import chalk from 'chalk'

const deploymentFunc: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  async function deploy (name: string, options: DeployOptions): Promise<DeployResult> {
    console.log('Deploying: ', name)
    const res = await hre.deployments.deploy(name, options)
    console.log(name, res.address, res.newlyDeployed === true ? 'newlyDeployed' : '')
    return res
  }

  const { deployer } = await hre.getNamedAccounts()
  const balance = await ethers.provider.getBalance(deployer)
  console.log('deployer=', deployer, 'balance=', balance.toString())
  // if (balance.isZero()) {
  //   console.error(chalk.red(`deployer account ${deployer as string} doesn't have eth balance ${balance.toString()}`))
  //   process.exit(1)
  // }
  const chainId = hre.network.config.chainId
  const envname = Object.keys(environments).find(env => environments[env as EnvironmentsKeys].chainId === chainId)
  console.log('loading env', envname ?? 'DefaultEnvironment')
  const env = envname != null ? environments[envname as EnvironmentsKeys] : defaultEnvironment

  const useStorage = process.env.USE_STORAGE
  if (useStorage == null) {
    console.error('must set USE_STORAGE to true/false')
    process.exit(1)
  }

  const isUsingRegistryStorage = useStorage?.match(/^[TtYy1]/) != null
  console.log( 'isUsingRegistryStorage=',isUsingRegistryStorage)

  const deployedForwarder = await deploy('Forwarder', {
    from: deployer
  })

  if (deployedForwarder.newlyDeployed) {
    const f = new hre.web3.eth.Contract(deployedForwarder.abi, deployedForwarder.address)
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
  const relayHub = await deploy('RelayHub', {
    from: deployer,
    args: [
      stakeManager.address,
      penalizer.address,
      hubConfig
    ]
  })

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

  const versionRegistry = await deploy('VersionRegistry', {
    from: deployer
  })

  if (versionRegistry.newlyDeployed || relayHub.newlyDeployed) {
    const versionRegistryAddress = versionRegistry.address
    const params: ConstructorParams = {
      provider: web3.currentProvider as any,
      environment: env,
      maxPageSize: -1,
      logger: console,
      deployment: { versionRegistryAddress }
    }
    const contractInteractor = await new ContractInteractor(params).init()
    const reg = new VersionRegistry(versionRegistry.receipt!.blockNumber, contractInteractor)
    // version is unique string for this hub deployment
    const ver = await ethers.provider.getBlockNumber()
    await reg.addVersion('hub', ver.toString(), relayHub.address, { from: deployer })
  }

  const deployedPm = await deploy('TestPaymasterEverythingAccepted', { from: deployer })
  if (deployedPm.newlyDeployed) {
    const pm = new ethers.Contract(deployedPm.address, deployedPm.abi, ethers.provider.getSigner())
    await pm.setRelayHub(relayHub.address)
    await pm.setTrustedForwarder(deployedForwarder.address)
  }
}

export default deploymentFunc
