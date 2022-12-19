import { RelayRequest } from '@opengsn/common'
import { defaultGsnConfig } from '@opengsn/provider'

const TestRelayHubValidator = artifacts.require('TestRelayHubValidator')

contract('RelayHubValidator', ([from, senderAddress, target, paymaster, relayWorker, forwarder]) => {
  let validator: any
  before(async () => {
    validator = await TestRelayHubValidator.new()
  })

  it('#len1 should return dynamic structure size', async () => {
    const wrappedDynamicParamSize = async function (bytesLength: number): Promise<number> { return validator.dynamicParamSize('0x' + '11'.repeat(bytesLength)).then((x: any) => x.toNumber()) }

    assert.equal(await wrappedDynamicParamSize(0), 1 * 32)
    assert.equal(await wrappedDynamicParamSize(1), 2 * 32)
    assert.equal(await wrappedDynamicParamSize(32), 2 * 32)
    assert.equal(await wrappedDynamicParamSize(33), 3 * 32)
    assert.equal(await wrappedDynamicParamSize(64), 3 * 32)
    assert.equal(await wrappedDynamicParamSize(65), 4 * 32)
  });

  [{},
    { approvalData: '0x12' },
    { approvalData: '0x123456' },
    { approvalData: '0x123456', signature: '0xabcd' },
    { signature: '0xab' },
    { data: '0x1234' },
    { data: '0x1234', signature: '0xabcdef' },
    { paymasterData: '0x12345678' },
    { suffix: '123456' },
    { data: '0x1234', signature: '0xabcdef', suffix: '123456' }
  ].forEach((appended: any) => {
    it(`should verify correct length with "${JSON.stringify(appended)}" `, async () => {
      const suffix = appended.suffix ?? ''

      const relayRequest: RelayRequest = {
        request: {
          from: senderAddress,
          to: target,
          value: '0',
          gas: '1',
          nonce: '2',
          data: appended.data ?? '0x',
          validUntilTime: '0'
        },
        relayData: {
          maxFeePerGas: '0',
          maxPriorityFeePerGas: '0',
          relayWorker,
          paymaster: paymaster,
          paymasterData: appended.paymasterData ?? '0x',
          clientId: '3',
          transactionCalldataGasUsed: '4',
          forwarder
        }
      }
      const verifyTransactionPacking = await validator.contract.methods.dummyRelayCall(
        defaultGsnConfig.domainSeparatorName,
        0,
        relayRequest,
        appended.signature ?? '0x',
        appended.approvalData ?? '0x')

      const encoded = verifyTransactionPacking.encodeABI()
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      const encodedWithSuffix = `${encoded}${suffix}`
      const ret: any = await web3.eth.call({ data: encodedWithSuffix, to: validator.address }).catch(e => e.message)
      if (suffix.length > 0) {
        assert.include(ret, 'extra msg.data bytes')
      } else {
        assert.equal(ret, '0x')
      }
    })
  })
})
