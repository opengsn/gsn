import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { TestVersionsInstance } from '../../types/truffle-contracts'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { HttpProvider } from 'web3-core'

const { expect } = chai.use(chaiAsPromised)

const TestVersions = artifacts.require('TestVersions')

contract('ContractInteractor', function () {
  let testVersions: TestVersionsInstance
  before(async function () {
    testVersions = await TestVersions.new()
  })

  context('#_validateCompatibility()', function () {
    it('should throw if the hub version is incompatible', async function () {
      const relayClient = new RelayClient(web3.currentProvider as HttpProvider, {
        relayHubAddress: testVersions.address
      })
      await expect(relayClient._init()).to.be.eventually.rejectedWith('Provided Hub version(3.0.0) is not supported by the current interactor')
    })

    it('should not throw if the hub address is not configured', async function () {
      const relayClient = new RelayClient(web3.currentProvider as HttpProvider, {})
      await relayClient._init()
    })
  })
})
