import { DeployFunction } from 'hardhat-deploy/types'
import { defaultEnvironment, environments, EnvironmentsKeys } from '@opengsn/common'
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
  console.log('deployer=', deployer)
  const balance = await ethers.provider.getBalance(deployer)
  if (balance.isZero()) {
    console.error(chalk.red(`deployer account ${deployer as string} doesn't have eth balance ${balance.toString()}`))
    process.exit(1)
  }
  const chainId = hre.network.config.chainId
  const envname = Object.keys(environments).find(env => environments[env as EnvironmentsKeys].chainId === chainId)
  console.log('loading env', envname ?? 'DefaultEnvironment')
  const env = envname != null ? environments[envname as EnvironmentsKeys] : defaultEnvironment

  const useEvents = process.env.USE_EVENTS
  if (useEvents == null) {
    console.error('must set USE_EVENTS to true/false')
    process.exit(1)
  }

  const isUsingRegistryStorage = useEvents?.match(/^[TtYy1]/) != null

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
      await hub.setRegistrar(relayRegistrar.address).then(ret => ret.wait())
    }
  }
}

export default deploymentFunc
