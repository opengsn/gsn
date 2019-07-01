const { BN, ether, expectEvent, time } = require('openzeppelin-test-helpers');

const { getTransactionHash, getTransactionSignature } = require('../src/js/relayclient/utils')

const RelayHub = artifacts.require('RelayHub');
const SampleRecipient = artifacts.require('SampleRecipient');

contract('RelayHub', function ([_, relayOwner, relay, sender, other]) {  // eslint-disable-line no-unused-vars
  const RelayCallStatusCodes = {
    'OK': new BN('0'),
    'CanRelayFailed': new BN('1'),
    'RelayedCallFailed': new BN('2'),
    'PreRelayedFailed': new BN('3'),
    'PostRelayedFailed': new BN('4'),
    'RecipientBalanceChanged': new BN('5'),
  };

  let relayHub;
  let recipient;

  beforeEach(async function () {
    relayHub = await RelayHub.new();
    recipient = await SampleRecipient.new(relayHub.address);
  });

  context('with staked relay', async function () {
    const unstakeDelay = time.duration.weeks(4);

    beforeEach(async function () {
      await relayHub.stake(relay, unstakeDelay, { value: ether('5'), from: relayOwner });
    });

    context('with registered relay', async function () {
      const url = 'http://relay.com';
      const fee = 10; // 10%

      beforeEach(async function () {
        await relayHub.registerRelay(fee, url, { from: relay });
      });

      describe('relayCall', async function () {
        const message = 'GSN RelayHub';

        const gasPrice = new BN('10');
        const gasLimit = new BN('1000000');
        const senderNonce = new BN('0');

        let txData;

        beforeEach(async function () {
          // truffle-contract doesn't let us create method data from the class, we need an actual instance
          txData = recipient.contract.methods.emitMessage(message).encodeABI();
        });

        context('with funded recipient', async function () {
          beforeEach(async function () {
            await relayHub.depositFor(recipient.address, { value: ether('1'), from: other });
          });

          describe('recipient balance withdrawal ban', async function () {
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
              const txHash = await getTransactionHash(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relayHub.address, relay);
              const signature = await getTransactionSignature(web3, sender, txHash);

              const { logs } = await relayHub.relayCall(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, '0x', signature, { from: relay, gasPrice, gasLimit });

              expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.RecipientBalanceChanged});
            }
          });
        });
      });
    });
  });
});
