import { DeployFunction } from 'hardhat-deploy/types';
import { defaultEnvironment, environments, EnvironmentsKeys } from "@opengsn/common"
import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { registerForwarderForGsn } from "@opengsn/common/dist/EIP712/ForwarderUtil";

const deploymentFunc: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {

  const { deployer } = await hre.getNamedAccounts()
  console.log('deployer=',deployer)
  console.log('accounts=', await ethers.provider.listAccounts())
  const chainId = hre.network.config.chainId
  const envname = Object.keys(environments).find(env => environments[env as EnvironmentsKeys].chainId === chainId)
  console.log('loading env', envname ?? 'DefaultEnvironment')
  const env = envname != null ? environments[envname as EnvironmentsKeys] : defaultEnvironment

  const deployedForwarder = await hre.deployments.deploy('Forwarder', {
    from: deployer
  })
  if (deployedForwarder.newlyDeployed === true) {
    const f = new hre.web3.eth.Contract(deployedForwarder.abi, deployedForwarder.address)
    await registerForwarderForGsn(f, {
      from: deployer
    })
  }

  const penalizer = await hre.deployments.deploy('Penalizer', {
    from: deployer,
    args: [env.penalizerConfiguration.penalizeBlockDelay,
      env.penalizerConfiguration.penalizeBlockDelay]
  })
  const stakeManager = await hre.deployments.deploy('StakeManager', {
    from: deployer,
    args: [env.maxUnstakeDelay]
  })

  const hubConfig = env.relayHubConfiguration
  const relayHub = await hre.deployments.deploy('RelayHub', {
    from: deployer,
    args: [stakeManager.address, penalizer.address, hubConfig]
  })

  console.log('hub addr=', relayHub.address)
};

export default deploymentFunc;