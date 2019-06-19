const { balance, BN, constants, ether, expectEvent, expectRevert, send, time } = require('openzeppelin-test-helpers');
const { ZERO_ADDRESS } = constants;

const { getTransactionHash, getTransactionSignature } = require('../src/js/relayclient/utils')

const RelayHub = artifacts.require('RelayHub');
const SampleRecipient = artifacts.require('SampleRecipient');

const { expect } = require('chai');

contract('RelayHub', function ([_, relayOwner, relay, sender, other]) {  // eslint-disable-line no-unused-vars
  const RelayCallStatusCodes = {
    OK: new BN('0'),
    CanRelayFailed: new BN('1'),
    RelayedCallFailed: new BN('2'),
    PreRelayedFailed: new BN('3'),
    PostRelayedFailed: new BN('4'),
    RecipientBalanceChanged: new BN('5'),
  };

  const PreconditionCheck = {
    OK: new BN('0'),
    WrongSignature: new BN('1'),
    WrongNonce: new BN('2'),
    AcceptRelayedCallReverted: new BN('3'),
    InvalidRecipientStatusCode: new BN('4'),
  };

  let relayHub;
  let recipient;

  beforeEach(async function () {
    relayHub = await RelayHub.new();
    recipient = await SampleRecipient.new(relayHub.address);
  });

  describe('relay management', function () {
    describe('staking', function () {
      it('unstaked relays can be staked for by anyone', async function () {
        const { logs } = await relayHub.stake(relay, time.duration.days(1), { value: ether('1'), from: other });
        expectEvent.inLogs(logs, 'Staked', { relay, stake: ether('1') });
      });

      it('relays cannot stake for themselves', async function () {
        await expectRevert(
          relayHub.stake(relay, time.duration.days(1), { value: ether('1'), from: relay }),
          'relay cannot stake for itself'
        );
      });

      it('relays cannot be staked for with a stake under the minimum', async function () {
        const minimumStake = ether('0.1');

        await expectRevert(
          relayHub.stake(relay, time.duration.days(1), { value: minimumStake.subn(1), from: other }),
          'stake lower than minimum'
        );
      });

      // current minUnstakeDelay is 0
      it.skip('relays cannot be staked for with an unstake delay under the minimum', async function () {
        const minimumUnstakeDelay = new BN('1');

        await expectRevert(
          relayHub.stake(relay, minimumUnstakeDelay.subn(1), { value: ether('1'), from: other }),
          'delay lower than minimum'
        );
      });

      context('with staked relay', function () {
        const initialStake = ether('2');
        const initialUnstakeDelay = time.duration.days(1);

        beforeEach(async function () {
          await relayHub.stake(relay, initialUnstakeDelay, { value: initialStake, from: relayOwner });
        });

        it('relay owner can be queried', async function () {
          expect(await relayHub.ownerOf(relay)).to.equal(relayOwner);
        });

        it('relay stake can be queried', async function () {
          expect(await relayHub.stakeOf(relay)).to.be.bignumber.equals(initialStake);
        });

        it('relay unstake delay can be queried', async function () {
          expect((await relayHub.relays(relay)).unstakeDelay).to.be.bignumber.equal(initialUnstakeDelay);
        });

        function testStake() {
          it('owner can increase the relay stake', async function () {
            const addedStake = ether('2');
            const { logs } = await relayHub.stake(relay, initialUnstakeDelay, { value: addedStake, from: relayOwner });
            expectEvent.inLogs(logs, 'Staked', { relay, stake: addedStake });

            expect(await relayHub.stakeOf(relay)).to.be.bignumber.equals(initialStake.add(addedStake));
          });

          it('owner can increase the unstake delay', async function () {
            const newUnstakeDelay = time.duration.days(2);
            const { logs } = await relayHub.stake(relay, newUnstakeDelay, { from: relayOwner });
            expectEvent.inLogs(logs, 'Staked', { relay, stake: '0' });

            expect((await relayHub.relays(relay)).unstakeDelay).to.be.bignumber.equals(newUnstakeDelay);
          });
        };

        testStake();

        it('owner cannot decrease the unstake delay', async function () {
          await expectRevert(
            relayHub.stake(relay, initialUnstakeDelay.subn(1), { from: relayOwner }),
            'unstakeDelay cannot be decreased'
          );
        });

        it('non-owner cannot stake or increase the unstake delay', async function () {
          await expectRevert(
            relayHub.stake(relay, initialUnstakeDelay, { from: other }),
            'not owner'
          );
        });

        context('with registered relay', function () {
          beforeEach(async function () {
            await relayHub.registerRelay(10, 'http://test.url.com', { from: relay });
          });

          testStake();

          context('with unregistered relay', function () {
            beforeEach(async function () {
              await relayHub.removeRelayByOwner(relay, { from: relayOwner });
            });

            it('relay cannot be staked for', async function () {
              await expectRevert(
                relayHub.stake(relay, initialUnstakeDelay, { from: relayOwner }),
                'wrong state for stake'
              );
            });

            context('with unstaked relay', function () {
              beforeEach(async function () {
                await time.increase(initialUnstakeDelay);
                await relayHub.unstake(relay, { from: relayOwner });
              });

              it('relay can be restaked for with another owner', async function () {
                await relayHub.stake(relay, initialUnstakeDelay, { value: initialStake, from: other });
                expect(await relayHub.ownerOf(relay)).to.equal(other);
              });
            });
          });
        });
      });
    });

    describe('registering', function () {
      const transactionFee = new BN('10');
      const url = 'http://relay.com';

      it('unstaked relays cannot be registered', async function () {
        await expectRevert(relayHub.registerRelay(transactionFee, url, { from: relay }), 'wrong state for stake');
      });

      context('with staked relay', function () {
        const stake = ether('2');
        const unstakeDelay = time.duration.days(1);

        beforeEach(async function () {
          await relayHub.stake(relay, unstakeDelay, { value: stake, from: relayOwner });
        });

        // This test caauses the relay account to have no more balance and all other tests to fail
        it.skip('a relay must have more than the minimum balance to be registered', async function () {
          const relayBalance = await balance.current(relay);

          // Minimum balance is 0.1 ether
          await send.ether(relay, ZERO_ADDRESS, relayBalance - ether('0.09'));

          await expectRevert(relayHub.registerRelay(transactionFee, url, { from: relay, gasPrice: 0 }), 'balance lower than minimum');
        });

        it('relay can register itself', async function () {
          const { logs } = await relayHub.registerRelay(transactionFee, url, { from: relay });
          expectEvent.inLogs(logs, 'RelayAdded', {
            relay, owner: relayOwner, transactionFee, stake , unstakeDelay, url
          });
        });

        context('with registered relay', function () {
          beforeEach(async function () {
            await relayHub.registerRelay(transactionFee, url, { from: relay });
          });

          it('relay transaction fee can be queried', async function () {
            expect((await relayHub.relays(relay)).transactionFee).to.be.bignumber.equals(transactionFee);
          });

          it('relays can re-register with different transaction fee and url', async function () {
            const newTransactionFee = new BN('20');
            const newUrl = 'http://new-relay.com';

            const { logs } = await relayHub.registerRelay(newTransactionFee, newUrl, { from: relay });
            expectEvent.inLogs(logs, 'RelayAdded', {
              relay, owner: relayOwner, transactionFee: newTransactionFee, stake , unstakeDelay, url: newUrl
            });
          });

          context('with removed relay', function () {
            beforeEach(async function () {
              await relayHub.removeRelayByOwner(relay, { from: relayOwner });
            });

            it('relay cannot re-register', async function () {
              await expectRevert(relayHub.registerRelay(transactionFee, url, { from: relay }), 'wrong state for stake');
            });
          });
        });
      });
    });

    describe('unregistering', function () {
      context('with staked relay', function () {
        const stake = ether('2');
        const unstakeDelay = time.duration.days(1);

        beforeEach(async function () {
          await relayHub.stake(relay, unstakeDelay, { value: stake, from: relayOwner });
        });

        it('an unregistered relay can be removed', async function () {
          const { logs } = await relayHub.removeRelayByOwner(relay, { from: relayOwner });
          expectEvent.inLogs(logs, 'RelayRemoved', {
            relay, unstakeTime: (await time.latest()).add(unstakeDelay)
          });
        });

        it('a registered relay can be removed', async function () {
          await relayHub.registerRelay(10, 'http://test.url.com', { from: relay });

          const { logs } = await relayHub.removeRelayByOwner(relay, { from: relayOwner });
          expectEvent.inLogs(logs, 'RelayRemoved', {
            relay, unstakeTime: (await time.latest()).add(unstakeDelay)
          });
        });

        it('non-owners cannot remove a relay', async function () {
          await expectRevert(relayHub.removeRelayByOwner(relay, { from: other }), 'not owner');
        });

        context('with removed relay', function () {
          beforeEach(async function () {
            await relayHub.removeRelayByOwner(relay, { from: relayOwner });
          });

          it('relay cannot be re-removed', async function () {
            await expectRevert(relayHub.removeRelayByOwner(relay, { from: relayOwner }), 'already removed');
          });
        });
      });
    });

    describe('unstaking', function () {
      it('unstaked relays cannnot be unstaked', async function () {
        await expectRevert(relayHub.unstake(relay, { from: other }), 'canUnstake failed');
      });

      context('with staked relay', function () {
        const stake = ether('2');
        const unstakeDelay = time.duration.days(1);

        beforeEach(async function () {
          await relayHub.stake(relay, unstakeDelay, { value: stake, from: relayOwner });
        });

        it('unregistered relays cannnot be unstaked', async function () {
          await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'canUnstake failed');
        });

        context('with registerd relay', function () {
          beforeEach(async function () {
            await relayHub.registerRelay(10, 'http://test.url.com', { from: relay });
          });

          it('unremoved relays cannot be unstaked', async function () {
            await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'canUnstake failed');
          });

          context('with removed relay', function () {
            beforeEach(async function () {
              await relayHub.removeRelayByOwner(relay, { from: relayOwner });
            });

            it('relay cannot be unstaked before unstakeTime', async function () {
              await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'canUnstake failed');
            });

            context('after unstakeTime', function () {
              beforeEach(async function () {
                await time.increase(unstakeDelay);
                expect(await time.latest()).to.be.bignumber.at.least((await relayHub.relays(relay)).unstakeTime);
              });

              it('owner can unstake relay', async function () {
                const relayOwnerBalanceTracker = await balance.tracker(relayOwner)
                const relayHubBalanceTracker = await balance.tracker(relayHub.address)

                // We call unstake with a gasPrice of zero to accurately measure the balance change in the relayOwner
                const { logs } = await relayHub.unstake(relay, { from: relayOwner, gasPrice: 0 });
                expectEvent.inLogs(logs, 'Unstaked', { relay, stake });

                expect(await relayOwnerBalanceTracker.delta()).to.be.bignumber.equals(stake);
                expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(stake.neg());
              });

              it('non-owner cannot unstake relay', async function () {
                await expectRevert(relayHub.unstake(relay, { from: other }), 'not owner');
              });

              context('with unstaked relay', function () {
                beforeEach(async function () {
                  await relayHub.unstake(relay, { from: relayOwner });
                });

                it('relay cannot be re-unstaked', async function () {
                  await expectRevert(relayHub.unstake(relay, { from: relayOwner }), 'canUnstake failed');
                });
              });
            });
          });
        });
      });
    });
  });

  describe('balances', function () {
    async function testDeposit(sender, recipient, amount) {
      const senderBalanceTracker = await balance.tracker(sender);
      const relayHubBalanceTracker = await balance.tracker(relayHub.address);

      const { logs } = await relayHub.depositFor(recipient, { from: sender, value: amount, gasPrice: 0 });
      expectEvent.inLogs(logs, 'Deposited', { src: recipient, amount });

      expect(await relayHub.balanceOf(recipient)).to.be.bignumber.equals(amount);
      expect(await senderBalanceTracker.delta()).to.be.bignumber.equals(amount.neg());
      expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(amount);
    }

    it('can deposit for self', async function () {
      await testDeposit(other, other, ether('1'));
    });

    it('can deposit for others', async function () {
      await testDeposit(other, recipient.address, ether('1'));
    });

    it('cannot deposit amounts larger than the limit', async function () {
      await expectRevert(
        relayHub.depositFor(recipient.address, { from: other, value: ether('3'), gasPrice: 0 }),
        'deposit too big'
      );
    });

    it('can deposit multiple times and have a total deposit larger than the limit', async function () {
      await relayHub.depositFor(recipient.address, { from: other, value: ether('1'), gasPrice: 0 });
      await relayHub.depositFor(recipient.address, { from: other, value: ether('1'), gasPrice: 0 });
      await relayHub.depositFor(recipient.address, { from: other, value: ether('1'), gasPrice: 0 });

      expect(await relayHub.balanceOf(recipient.address)).to.be.bignumber.equals(ether('3'));
    });

    it('accounts with deposits can withdraw partially', async function () {
      const amount = ether('1');
      await testDeposit(other, other, amount);

      const { logs } = await relayHub.withdraw(amount.divn(2), { from: other });
      expectEvent.inLogs(logs, 'Withdrawn', { dest: other, amount: amount.divn(2) });
    });

    it('accounts with deposits can withdraw all their balance', async function () {
      const amount = ether('1');
      await testDeposit(other, other, amount);

      const { logs } = await relayHub.withdraw(amount, { from: other });
      expectEvent.inLogs(logs, 'Withdrawn', { dest: other, amount });
    });

    it('accounts cannot withdraw more than their balance', async function () {
      const amount = ether('1');
      await testDeposit(other, other, amount);

      await expectRevert(relayHub.withdraw(amount.addn(1), { from: other }), 'insufficient funds');
    });
  });

  describe('canRelay & relayCall', function () {
    context('with staked and registered relay', function () {
      const unstakeDelay = time.duration.weeks(4);

      const url = 'http://relay.com';
      const fee = 10; // 10%

      beforeEach(async function () {
        await relayHub.stake(relay, unstakeDelay, { value: ether('5'), from: relayOwner });

        await relayHub.registerRelay(fee, url, { from: relay });
      });

      const message = 'GSN RelayHub';

      const gasPrice = new BN('10');
      const gasLimit = new BN('1000000');
      const senderNonce = new BN('0');

      let txData;
      let txHash;
      let signature;

      beforeEach(async function () {
        // truffle-contract doesn't let us create method data from the class, we need an actual instance
        txData = recipient.contract.methods.emitMessage(message).encodeABI();

        txHash = await getTransactionHash(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relayHub.address, relay);
        signature = await getTransactionSignature(web3, sender, txHash);
      });

      context('with funded recipient', function () {
        beforeEach(async function () {
          await relayHub.depositFor(recipient.address, { value: ether('1'), from: other });
        });

        it('relaying is aborted if the recipient returns an invalid status code', async function () {
          await recipient.setReturnInvalidErrorCode(true);
          const { logs } = await relayHub.relayCall(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, signature, { from: relay, gasPrice, gasLimit });

          expectEvent.inLogs(logs, 'TransactionRelayed', {
            status: RelayCallStatusCodes.CanRelayFailed,
            chargeOrCanRelayStatus: PreconditionCheck.InvalidRecipientStatusCode
          });
        });

        describe('recipient balance withdrawal ban', function () {
          it('reverts relayed call if recipient withdraws balance during preRelayedCall', async function () {
            await recipient.setWithdrawDuringPreRelayedCall(true);
            await assertRevertWithRecipientBalanceChanged();
          });

          it('reverts relayed call if recipient withdraws balance during the relayed call', async function () {
            await recipient.setWithdrawDuringRelayedCall(true);
            await assertRevertWithRecipientBalanceChanged();
          });

          it('reverts relayed call if recipient withdraws balance during postRelayedCall', async function () {
            await recipient.setWithdrawDuringPostRelayedCall(true);
            await assertRevertWithRecipientBalanceChanged();
          });

          async function assertRevertWithRecipientBalanceChanged() {
            const { logs } = await relayHub.relayCall(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, signature, { from: relay, gasPrice, gasLimit });

            expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.RecipientBalanceChanged});
          }
        });
      });
    });
  });
});
