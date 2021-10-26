import { DeployFunction } from 'hardhat-deploy/types';
import { defaultEnvironment, environments } from "@opengsn/common"
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { registerForwarderForGsn } from "@opengsn/common/dist/EIP712/ForwarderUtil";
import { ethers } from "hardhat";

const deploymentFunc: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {

    console.log('==deploy')

    const {deployer} = await hre.getNamedAccounts()

    const chainId = hre.network.config.chainId
    const envname = Object.keys(environments).find(env => environments[env].chainId == chainId)
    console.log('loading env', envname ?? 'DefaultEnvironment')
    const env: any = envname != null ? environments[envname] : defaultEnvironment

    const deployedForwarder = await hre.deployments.deploy('Forwarder', {
        from: deployer
    })
    if (deployedForwarder.newlyDeployed) {
        const signer = ethers.provider.getSigner()
        // const forwarder = getContract(env, 'Forwarder', signer)
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
        args: [env.unstakeDelay]
    })
};
export default deploymentFunc;