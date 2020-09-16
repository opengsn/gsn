// test possible client errors

import { GsnTestEnvironment, TestEnvironment } from '../../src/relayclient/GsnTestEnvironment'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { resolveConfigurationGSN } from '../../src/relayclient/GSNConfigurator'
import { constants } from '../../src/common/Constants'
import { DeploymentResult } from '../../src/cli/CommandsLogic'
import { PrefixedHexString } from 'ethereumjs-tx'
import ContractInteractor, { Web3Provider } from '../../src/relayclient/ContractInteractor'
import { HttpProvider } from 'web3-core'

const { assert, expect } = chai.use(chaiAsPromised)

contract('client-configuration', () => {
  let env: TestEnvironment
  let deploymentResult: DeploymentResult
  let paymasterAddress: PrefixedHexString
  before(async () => {
    const host = (web3.currentProvider as HttpProvider).host
    env = await GsnTestEnvironment.startGsn(host)
    deploymentResult = env.deploymentResult
    // deploymentResult = loadDeployment('./build/gsn')
    paymasterAddress = deploymentResult.naivePaymasterAddress
  })
  describe('#resolveConfigurationGSN', () => {
    describe('failures', () => {
      it('should fail with no params', async () => {
        // @ts-ignore
        await expect(resolveConfigurationGSN()).to.eventually.rejectedWith(/Cannot read property/)
      })

      it('should throw if the first arg not provider', async () => {
        // @ts-ignore
        await expect(resolveConfigurationGSN({})).to.eventually.rejectedWith(/First param is not a web3 provider/)
      })
      it('should throw if no paymaster in config', async () => {
        await expect(resolveConfigurationGSN(web3.currentProvider as Web3Provider, {}))
          .to.eventually.rejectedWith('Cannot resolve GSN deployment without paymaster address')
      })
      it('should throw if no contract at paymaster address ', async () => {
        await expect(resolveConfigurationGSN(web3.currentProvider as Web3Provider, { paymasterAddress: constants.ZERO_ADDRESS }))
          .to.eventually.rejectedWith('no code at address ')
      })

      it('should throw if not a paymaster contract', async () => {
        await expect(resolveConfigurationGSN(web3.currentProvider as Web3Provider, { paymasterAddress: deploymentResult.stakeManagerAddress }))
          .to.eventually.rejectedWith('Not a paymaster contract')
      })

      it.skip('should throw if wrong contract paymaster version', async () => {
        // instead of deploying a new paymaster with a different version, we make our client version older
        // since resolveConfigurationGSN creates its own ContractInteractor, we have to hook the class to modify the version
        // after it is created...

        const saveCPM = ContractInteractor.prototype._createPaymaster
        try {
          ContractInteractor.prototype._createPaymaster = async function (addr) {
            (this as any).versionManager.componentVersion = '1.0.0-old-client'
            console.log('hooked _createPaymaster with version')
            return await saveCPM.call(this, addr)
          }

          await expect(resolveConfigurationGSN(web3.currentProvider as Web3Provider, { paymasterAddress }))
            .to.eventually.rejectedWith(/Provided.*version.*is not supported/)
        } finally {
          ContractInteractor.prototype._createPaymaster = saveCPM
        }
      })
    })

    describe('with successful resolveConfigurationGSN', () => {
      it('should fill relayHub, stakeManager, Forwarder from valid paymaster paymaster address ', async () => {
        const gsnConfig = await resolveConfigurationGSN(web3.currentProvider as Web3Provider, { paymasterAddress })
        assert.equal(gsnConfig.relayHubAddress, deploymentResult.relayHubAddress)
        assert.equal(gsnConfig.paymasterAddress, deploymentResult.naivePaymasterAddress)
        assert.equal(gsnConfig.forwarderAddress, deploymentResult.forwarderAddress)
      })
      it('should set metamask defaults', async () => {
        const metamaskProvider = {
          isMetaMask: true,
          send: (options: any, cb: any) => {
            (web3.currentProvider as any).send(options, cb)
          }
        } as any
        const gsnConfig = await resolveConfigurationGSN(metamaskProvider, { paymasterAddress })
        assert.equal(gsnConfig.methodSuffix, '_v4')
        assert.equal(gsnConfig.jsonStringifyRequest, true)
      })

      it('should allow to override metamask defaults', async () => {
        const metamaskProvider = {
          isMetaMask: true,
          send: (options: any, cb: any) => {
            (web3.currentProvider as any).send(options, cb)
          }
        } as any

        // note: to check boolean override, we explicitly set it to something that
        // is not in the defaults..
        const gsnConfig = await resolveConfigurationGSN(metamaskProvider, { paymasterAddress, methodSuffix: 'suffix', jsonStringifyRequest: 5 as unknown as boolean })
        assert.equal(gsnConfig.methodSuffix, 'suffix')
        assert.equal(gsnConfig.jsonStringifyRequest as any, 5)
      })
    })
  })
})
