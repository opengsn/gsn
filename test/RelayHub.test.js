const { balance, BN, constants, ether, expectEvent, expectRevert, send, time } = require('openzeppelin-test-helpers');
const { ZERO_ADDRESS } = constants;

const { getTransactionHash, getTransactionSignature } = require('../src/js/relayclient/utils')

const RelayHub = artifacts.require('RelayHub');
const SampleRecipient = artifacts.require('SampleRecipient');

const Transaction = require('ethereumjs-tx');
const { privateToAddress } = require('ethereumjs-util');
const rlp = require('rlp');

const { expect } = require('chai');

contract('RelayHub', function ([_, relayOwner, relay, otherRelay, sender, other]) {  // eslint-disable-line no-unused-vars
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
        }

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

  describe('penalizations', function () {
    describe('triggers', function () {
      context('with staked relay', function () {
        beforeEach(async function () {
          await relayHub.stake(relay, time.duration.days(1), { value: ether('1') });
        });

        describe.skip('repeated relay nonce', async function () {
          // Some of these tests require signing using the relay's private key. For convenience, we hardcode it here and run
          // ganache in deterministic mode, to always get the same key.
          const relayPrivateKey = '0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c';

          before(function () {
            // We need to make sure the private key is the relay's
            expect(relay.toLowerCase()).to.equal("0x" + privateToAddress(relayPrivateKey).toString('hex'));
          });
        });

        describe('illegal call', async function () {
          describe('with pre-EIP155 signatures', function () {
            it('penalizes relay transactions to addresses other than RelayHub', async function () {
              // Relay sending ether to another account
              const { transactionHash } = await send.ether(relay, other, ether('0.5'));
              const { data, signature } = await getDataAndSignature(transactionHash);

              const { logs } = await relayHub.penalizeIllegalTransaction(data, signature);
              expectEvent.inLogs(logs, 'Penalized', { relay });
            });

            it('penalizes relay transactions to illegal RelayHub functions (stake)', async function () {
              // Relay staking for a second relay
              const { tx } = await relayHub.stake(other, time.duration.days(1), { value: ether('0.5'), from: relay });
              const { data, signature } = await getDataAndSignature(tx);

              const { logs } = await relayHub.penalizeIllegalTransaction(data, signature);
              expectEvent.inLogs(logs, 'Penalized', { relay });
            });

            it('penalizes relay transactions to illegal RelayHub functions (penalize)', async function () {
              // A second relay is registered
              await relayHub.stake(otherRelay, time.duration.days(1), { value: ether('0.5'), from: other });

              // An illegal transaction is sent by it
              const stakeTx = await send.ether(otherRelay, other, ether('0.5'));

              // A relay penalizes it
              const stakeTxDataSig = await getDataAndSignature(stakeTx.transactionHash);
              const penalizeTx = await relayHub.penalizeIllegalTransaction(
                stakeTxDataSig.data, stakeTxDataSig.signature, { from: relay }
              );

              // It can now be penalized for that
              const penalizeTxDataSig = await getDataAndSignature(penalizeTx.tx);
              const secondPenalizeTx = await relayHub.penalizeIllegalTransaction(
                penalizeTxDataSig.data, penalizeTxDataSig.signature
              );

              expectEvent.inLogs(secondPenalizeTx.logs, 'Penalized', { relay });
            });

            it('does not penalize legal relay transactions', async function () {
              // registerRelay is a legal transaction

              const registerTx = await relayHub.registerRelay(10, 'url.com', { from: relay });
              const registerTxDataSig = await getDataAndSignature(registerTx.tx);

              await expectRevert(
                relayHub.penalizeIllegalTransaction(registerTxDataSig.data, registerTxDataSig.signature),
                 'Legal relay transaction'
              );

              // relayCall is a legal transaction

              const fee = new BN('10');
              const gasPrice = new BN('1');
              const gasLimit = new BN('1000000');
              const senderNonce = new BN('0');
              const txData = recipient.contract.methods.emitMessage('').encodeABI();
              const signature = await getTransactionSignature(
                web3,
                sender,
                getTransactionHash(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relayHub.address, relay)
              );

              await relayHub.depositFor(recipient.address, { from: other, value: ether('1') });
              const relayCallTx = await relayHub.relayCall(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, signature, { from: relay, gasPrice, gasLimit });

              const relayCallTxDataSig = await getDataAndSignature(relayCallTx.tx);
              await expectRevert(
                relayHub.penalizeIllegalTransaction(relayCallTxDataSig.data, relayCallTxDataSig.signature),
                 'Legal relay transaction'
              );
            });
          });
        });

        describe.skip('with EIP155 signatures', function () {
        });
      });
    });

    describe('relay state and reward', function () {
      context('with penalizable transaction', function () {
        let penalizableTxData;
        let penalizableTxSignature;

        const reporter = other;
        const stake = ether('1');

        beforeEach(async function () {
          // Relays are not allowed to transfer Ether
          const { transactionHash } = await send.ether(relay, other, ether('0.5'));
          ({ data: penalizableTxData, signature: penalizableTxSignature } = await getDataAndSignature(transactionHash));
        });

        function penalizeFrom (from) {
          // Penalize with a gasPrice of 0 to help in balance change calculations
          return relayHub.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, { from, gasPrice: 0 });
        }

        function testRelayPenalization () {
          it('relay can be penalized', async function () {
            const reporterBalanceTracker = await balance.tracker(reporter);
            const relayHubBalanceTracker = await balance.tracker(relayHub.address);

            const { logs } = await penalizeFrom(reporter);
            expectEvent.inLogs(logs, 'Penalized', { relay, sender: reporter, amount: stake.divn(2) });

            // The reporter gets half of the stake
            expect(await reporterBalanceTracker.delta()).to.be.bignumber.equals(stake.divn(2));

            // The other half is burned, so RelayHub's balance is decreased by the full stake
            expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(stake.neg());
          });

          context('once penalized', function () {
            beforeEach(async function () {
              await penalizeFrom(reporter);
            });

            it('relay cannot be penalized again', async function () {
              await expectRevert(penalizeFrom(reporter), 'Unstaked relay');
            });
          });
        }

        context('with unstaked relay', function () {
          it('account cannot be penalized', async function () {
            await expectRevert(penalizeFrom(reporter), 'Unstaked relay');
          });

          context('with staked relay', function () {
            const unstakeDelay = time.duration.days(1);

            beforeEach(async function () {
              await relayHub.stake(relay, unstakeDelay, { value: stake, from: relayOwner });
            });

            testRelayPenalization();

            context('with registered relay', function () {
              beforeEach(async function () {
                await relayHub.registerRelay(10, 'url.com', { from: relay });
              });

              testRelayPenalization();

              it('RelayRemoved event is emitted', async function () {
                const { logs } = await penalizeFrom(reporter);
                expectEvent.inLogs(logs, 'RelayRemoved', { relay, unstakeTime: await time.latest() });
              });

              context('with removed relay', function () {
                beforeEach(async function () {
                  await relayHub.removeRelayByOwner(relay, { from: relayOwner });
                });

                testRelayPenalization();

                context('with unstaked relay', function () {
                  beforeEach(async function () {
                    await time.increase(unstakeDelay);
                    await relayHub.unstake(relay, { from: relayOwner });
                  });

                  it('relay cannot be penalized', async function () {
                    await expectRevert(penalizeFrom(reporter), 'Unstaked relay');
                  });
                });
              });
            });
          });
        });
      });
    });

    async function getDataAndSignature(txHash) {
      const rpcTx = await web3.eth.getTransaction(txHash);

      const tx = new Transaction({
        nonce: new BN(rpcTx.nonce),
        gasPrice: new BN(rpcTx.gasPrice),
        gasLimit: new BN(rpcTx.gas),
        to: rpcTx.to,
        value: new BN(rpcTx.value),
        data: rpcTx.input,
        v: rpcTx.v,
        r: rpcTx.r,
        s: rpcTx.s,
      });

      const data = `0x${rlp.encode([tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]).toString('hex')}`;
      const signature = `0x${tx.v.toString('hex')}${tx.r.toString('hex')}${tx.s.toString('hex')}`

      return { data, signature };
    }
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

        txHash = getTransactionHash(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relayHub.address, relay);
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
