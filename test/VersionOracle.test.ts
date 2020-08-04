import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { VersionOracleInstance } from '../types/truffle-contracts'
import { constants } from '../src/common/Constants'

const { expect } = chai.use(chaiAsPromised)

const VersionOracle = artifacts.require('VersionOracle')

interface Deployment {
  relayHubAddress: string
  stakeManagerAddress: string
  penalizerAddress: string
}

contract.only('VersionOracle', function (accounts) {
  const apiLevel = 1
  const deployment = {
    relayHubAddress: '0x0000000000000000000000000000000000000001',
    stakeManagerAddress: '0x0000000000000000000000000000000000000002',
    penalizerAddress: '0x0000000000000000000000000000000000000003'
  }
  let versionOracle: VersionOracleInstance

  before(async function () {
    versionOracle = await VersionOracle.new()
  })

  function compareDeployments (actual: Deployment, expected: Deployment): void {
    assert.equal(actual.relayHubAddress, expected.relayHubAddress)
    assert.equal(actual.stakeManagerAddress, expected.stakeManagerAddress)
    assert.equal(actual.penalizerAddress, expected.penalizerAddress)
  }

  describe('#getDeployment', function () {
    it('should return an empty response if not available', async function () {
      const emptyDeployment = {
        relayHubAddress: constants.ZERO_ADDRESS,
        stakeManagerAddress: constants.ZERO_ADDRESS,
        penalizerAddress: constants.ZERO_ADDRESS
      }
      const fetchedDeployment = await versionOracle.getDeployment(apiLevel)
      compareDeployments(fetchedDeployment, emptyDeployment)
    })
  })

  describe('#setDeployment()', function () {
    it('should not allow non-owner to call', async function () {
      await expect(
        versionOracle.setDeployment(1, deployment, { from: accounts[1] })
      ).to.be.eventually.rejectedWith('caller is not the owner')
    })

    it('should allow owner to create a new deployment', async function () {
      await versionOracle.setDeployment(apiLevel, deployment)
      const fetchedDeployment = await versionOracle.getDeployment(apiLevel)
      compareDeployments(fetchedDeployment, deployment)
    })

    it('should allow owner to change deployment for API level', async function () {
      let fetchedDeployment = await versionOracle.getDeployment(apiLevel)
      compareDeployments(fetchedDeployment, deployment)
      deployment.relayHubAddress = '0x0000000000000000000000000000000000000aaa'
      await versionOracle.setDeployment(apiLevel, deployment)
      fetchedDeployment = await versionOracle.getDeployment(apiLevel)
      compareDeployments(fetchedDeployment, deployment)
    })
  })
})
