/* global before */
/* eslint-disable @typescript-eslint/no-empty-function */

import { StakeManagerInstance } from '../types/truffle-contracts'

const StakeManager = artifacts.require('StakeManager')

contract.skip('StakeHolder', function ([_, relay]) {
  describe('', function () {
    let stakeHolder: StakeManagerInstance

    before(async function () {
      stakeHolder = await StakeManager.new()
      console.log(stakeHolder.address)
    })

    it('should accept stakes from new relays', async function () {
    })

    // run for: unauthorized hub, stake owner, random account
    it('should not allow __ADDRESS__ to withdraw stakes', async function () {
    })

    it('should allow stake owner to authorize new relay hub', async function () {
    })

    // this test runs twice - for original and for added hub
    it('should allow authorized hub to withdraw stakes', async function () {
    })

    it('should allow querying authorized hubs per relay', async function () {
    })

    it('should allow querying stake per relay', async function () {
    })
  })
})
