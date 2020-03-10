const { balance, BN, constants, ether, expectEvent, expectRevert, send, time } = require('@openzeppelin/test-helpers')
const { ZERO_ADDRESS } = constants

const TestRecipientUtils = artifacts.require('./TestRecipientUtils.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient')
const TestSponsor = artifacts.require('./test/TestSponsorEverythingAccepted')
const RelayHub = artifacts.require('RelayHub')

const { expect } = require('chai')
const Environments = require('../src/js/relayclient/Environments')

contract('RelayHub Stake Management', function ([_, relayOwner, relay, otherRelay, sender, other, dest]) { // eslint-disable-line no-unused-vars
  let relayHub
  let recipient
  let gasSponsor

  beforeEach(async function () {
    relayHub = await RelayHub.new(Environments.default.gtxdatanonzero, { gas: 10000000 })
    recipient = await SampleRecipient.new()
    gasSponsor = await TestSponsor.new()
    await recipient.setHub(relayHub.address)
    await gasSponsor.setHub(relayHub.address)
  })

  describe('relay management', function () {
    describe('staking', function () {
      it('unstaked relays can be staked for by anyone', async function () {
        const { logs } = await relayHub.stake(relay, time.duration.weeks(4), {
          value: ether('1'),
          from: other
        })
        expectEvent.inLogs(logs, 'Staked', {
          relay,
          stake: ether('1'),
          unstakeDelay: time.duration.weeks(4)
        })
      })

      it('relays cannot stake for themselves', async function () {
        await expectRevert(
          relayHub.stake(relay, time.duration.weeks(4), {
            value: ether('1'),
            from: relay
          }),
          'relay cannot stake for itself'
        )
      })

      it('relays cannot be staked for with a stake under the minimum', async function () {
        const minimumStake = ether('1')

        await expectRevert(
          relayHub.stake(relay, time.duration.weeks(4), {
            value: minimumStake.subn(1),
            from: other
          }),
          'stake lower than minimum'
        )
      })

      it('relays cannot be staked for with an unstake delay under the minimum', async function () {
        const minimumUnstakeDelay = time.duration.weeks(1)

        await expectRevert(
          relayHub.stake(relay, minimumUnstakeDelay.subn(1), {
            value: ether('1'),
            from: other
          }),
          'delay lower than minimum'
        )
      })

      it('relays cannot be staked for with an unstake delay over the maximum', async function () {
        const maximumUnstakeDelay = time.duration.weeks(12)

        await expectRevert(
          relayHub.stake(relay, maximumUnstakeDelay.addn(1), {
            value: ether('1'),
            from: other
          }),
          'delay higher than maximum'
        )
      })

      context('with staked relay', function () {
        const initialStake = ether('2')
        const initialUnstakeDelay = time.duration.weeks(4)

        beforeEach(async function () {
          await relayHub.stake(relay, initialUnstakeDelay, {
            value: initialStake,
            from: relayOwner
          })
        })

        it('relay owner can be queried', async function () {
          expect((await relayHub.getRelay(relay)).owner).to.equal(relayOwner)
        })

        it('relay stake can be queried', async function () {
          expect((await relayHub.getRelay(relay)).totalStake).to.be.bignumber.equals(initialStake)
        })

        it('relay unstake delay can be queried', async function () {
          expect((await relayHub.getRelay(relay)).unstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)
        })

        function testStake () {
          it('owner can increase the relay stake', async function () {
            const addedStake = ether('2')
            const { logs } = await relayHub.stake(relay, initialUnstakeDelay, {
              value: addedStake,
              from: relayOwner
            })
            expectEvent.inLogs(logs, 'Staked', {
              relay,
              stake: initialStake.add(addedStake),
              unstakeDelay: initialUnstakeDelay
            })

            expect((await relayHub.getRelay(relay)).totalStake).to.be.bignumber.equals(initialStake.add(addedStake))
          })

          it('owner can increase the unstake delay', async function () {
            const newUnstakeDelay = time.duration.weeks(6)
            const { logs } = await relayHub.stake(relay, newUnstakeDelay, { from: relayOwner })
            expectEvent.inLogs(logs, 'Staked', {
              relay,
              stake: initialStake,
              unstakeDelay: newUnstakeDelay
            })

            expect((await relayHub.getRelay(relay)).unstakeDelay).to.be.bignumber.equals(newUnstakeDelay)
          })
        }

        testStake()

        it('owner cannot decrease the unstake delay', async function () {
          await expectRevert(
            relayHub.stake(relay, initialUnstakeDelay.subn(1), { from: relayOwner }),
            'unstakeDelay cannot be decreased'
          )
        })

        it('non-owner cannot stake or increase the unstake delay', async function () {
          await expectRevert(
            relayHub.stake(relay, initialUnstakeDelay, { from: other }),
            'not owner'
          )
        })

        describe('limitations on relay registration', async function () {
          it('should forbid contracts-owned addresses to register as relays', async function () {
            const testutils = await TestRecipientUtils.new()
            await web3.eth.sendTransaction({
              from: other,
              to: testutils.address,
              value: 0.6e18
            })
            await relayHub.stake(testutils.address, 3600 * 24 * 7, { value: 1e18 })
            await expectRevert(
              testutils.registerAsRelay(relayHub.address),
              'Contracts cannot register as relays')
          })

          it('should forbid owners address to register as relay', async function () {
            await expectRevert(
              relayHub.stake(otherRelay, time.duration.weeks(1), {
                from: otherRelay,
                value: ether('1')
              }), 'relay cannot stake for itself')
          })
        })

        context('with registered relay', function () {
          beforeEach(async function () {
            await relayHub.registerRelay(10, 'http://test.url.com', { from: relay })
          })

          testStake()

          context('with unregistered relay', function () {
            beforeEach(async function () {
              await relayHub.removeRelayByOwner(relay, { from: relayOwner })
            })

            it('relay cannot be staked for', async function () {
              await expectRevert(
                relayHub.stake(relay, initialUnstakeDelay, { from: relayOwner }),
                'wrong state for stake'
              )
            })

            context('with unstaked relay', function () {
              beforeEach(async function () {
                await time.increase(initialUnstakeDelay)
                await relayHub.unstake(relay, { from: relayOwner })
              })

              it('relay can be restaked for with another owner', async function () {
                await relayHub.stake(relay, initialUnstakeDelay, {
                  value: initialStake,
                  from: other
                })
                expect((await relayHub.getRelay(relay)).owner).to.equal(other)
              })
            })
          })
        })
      })
    })

    describe('registering', function () {
      const transactionFee = new BN('10')
      const url = 'http://relay.com'

      it('unstaked relays cannot be registered', async function () {
        await expectRevert(relayHub.registerRelay(transactionFee, url, { from: relay }), 'wrong state for register')
      })

      context('with staked relay', function () {
        const stake = ether('2')
        const unstakeDelay = time.duration.weeks(4)

        beforeEach(async function () {
          await relayHub.stake(relay, unstakeDelay, {
            value: stake,
            from: relayOwner
          })
        })

        // This test caauses the relay account to have no more balance and all other tests to fail
        it.skip('a relay must have more than the minimum balance to be registered', async function () {
          const relayBalance = await balance.current(relay)

          // Minimum balance is 0.1 ether
          await send.ether(relay, ZERO_ADDRESS, relayBalance - ether('0.09'))

          await expectRevert(relayHub.registerRelay(transactionFee, url, {
            from: relay,
            gasPrice: 0
          }), 'balance lower than minimum')
        })

        it('relay can register itself', async function () {
          const { logs } = await relayHub.registerRelay(transactionFee, url, { from: relay })
          expectEvent.inLogs(logs, 'RelayAdded', {
            relay,
            owner: relayOwner,
            transactionFee,
            stake,
            unstakeDelay,
            url
          })
        })

        context('with registered relay', function () {
          beforeEach(async function () {
            await relayHub.registerRelay(transactionFee, url, { from: relay })
          })

          it('relays can re-register with different transaction fee and url', async function () {
            const newTransactionFee = new BN('20')
            const newUrl = 'http://new-relay.com'

            const { logs } = await relayHub.registerRelay(newTransactionFee, newUrl, { from: relay })
            expectEvent.inLogs(logs, 'RelayAdded', {
              relay,
              owner: relayOwner,
              transactionFee: newTransactionFee,
              stake,
              unstakeDelay,
              url: newUrl
            })
          })

          context('with removed relay', function () {
            beforeEach(async function () {
              await relayHub.removeRelayByOwner(relay, { from: relayOwner })
            })

            it('relay cannot re-register', async function () {
              await expectRevert(relayHub.registerRelay(transactionFee, url, { from: relay }), 'wrong state for register')
            })
          })
        })
      })
    })

    describe('unregistering', function () {
      context('with staked relay', function () {
        const stake = ether('2')
        const unstakeDelay = time.duration.weeks(4)

        beforeEach(async function () {
          await relayHub.stake(relay, unstakeDelay, {
            value: stake,
            from: relayOwner
          })
        })

        it('an unregistered relay can be removed', async function () {
          const { logs } = await relayHub.removeRelayByOwner(relay, { from: relayOwner })
          expectEvent.inLogs(logs, 'RelayRemoved', {
            relay,
            unstakeTime: (await time.latest()).add(unstakeDelay)
          })
        })

        it('a registered relay can be removed', async function () {
          await relayHub.registerRelay(10, 'http://test.url.com', { from: relay })

          const { logs } = await relayHub.removeRelayByOwner(relay, { from: relayOwner })
          expectEvent.inLogs(logs, 'RelayRemoved', {
            relay,
            unstakeTime: (await time.latest()).add(unstakeDelay)
          })
        })

        it('non-owners cannot remove a relay', async function () {
          await expectRevert(relayHub.removeRelayByOwner(relay, { from: other }), 'not owner')
        })

        context('with removed relay', function () {
          beforeEach(async function () {
            await relayHub.removeRelayByOwner(relay, { from: relayOwner })
          })

          it('relay cannot be re-removed', async function () {
            await expectRevert(relayHub.removeRelayByOwner(relay, { from: relayOwner }), 'already removed')
          })
        })
      })
    })

    describe('unstaking', function () {
      before(async function () {
        await time.increase(time.duration.weeks(4))
        await relayHub.unstake(relay, { from: relayOwner })
      })

      it('unstaked relays cannot be unstaked', async function () {
        await expectRevert(relayHub.unstake(relay, { from: other }), 'Relay is not pending unstake')
      })

      context('with staked relay', function () {
        const stake = ether('2')
        const unstakeDelay = time.duration.weeks(4)

        beforeEach(async function () {
          await relayHub.stake(relay, unstakeDelay, {
            value: stake,
            from: relayOwner
          })
        })

        it('unregistered relays cannnot be unstaked', async function () {
          await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'Relay is not pending unstake')
        })

        context('with registerd relay', function () {
          beforeEach(async function () {
            await relayHub.registerRelay(10, 'http://test.url.com', { from: relay })
          })

          it('unremoved relays cannot be unstaked', async function () {
            await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'Relay is not pending unstake')
          })

          context('with removed relay', function () {
            beforeEach(async function () {
              await relayHub.removeRelayByOwner(relay, { from: relayOwner })
            })

            it('relay cannot be unstaked before unstakeTime', async function () {
              await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'Unstake is not due')
            })

            context('after unstakeTime', function () {
              beforeEach(async function () {
                await time.increase(unstakeDelay)
                expect(await time.latest()).to.be.bignumber.at.least((await relayHub.getRelay(relay)).unstakeTime)
              })

              it('owner can unstake relay', async function () {
                const relayOwnerBalanceTracker = await balance.tracker(relayOwner)
                const relayHubBalanceTracker = await balance.tracker(relayHub.address)

                // We call unstake with a gasPrice of zero to accurately measure the balance change in the relayOwner
                const { logs } = await relayHub.unstake(relay, {
                  from: relayOwner,
                  gasPrice: 0
                })
                expectEvent.inLogs(logs, 'Unstaked', {
                  relay,
                  stake
                })

                expect(await relayOwnerBalanceTracker.delta()).to.be.bignumber.equals(stake)
                expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(stake.neg())
              })

              it('non-owner cannot unstake relay', async function () {
                await expectRevert(relayHub.unstake(relay, { from: other }), 'not owner')
              })

              context('with unstaked relay', function () {
                beforeEach(async function () {
                  await relayHub.unstake(relay, { from: relayOwner })
                })

                it('relay cannot be re-unstaked', async function () {
                  await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'Relay is not pending unstake')
                })
              })
            })
          })
        })
      })
    })
  })
})
