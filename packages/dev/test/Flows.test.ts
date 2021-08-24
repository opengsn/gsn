// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"
import { HttpProvider } from 'web3-core'

import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import { Address, AsyncDataCallback } from '@opengsn/common/dist/types/Aliases'
import {
  RelayHubInstance, StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance, TestPaymasterPreconfiguredApprovalInstance,
  TestRecipientInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { deployHub, emptyBalance, startRelay, stopRelay } from './TestUtils'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { ether } from '@opengsn/common'

const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestPaymasterPreconfiguredApproval = artifacts.require('TestPaymasterPreconfiguredApproval')

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')

const options = [
  {
    title: 'Direct-',
    relay: false
  },
  {
    title: 'Relayed-',
    relay: true
  }
]

options.forEach(params => {
  contract(params.title + 'Flow', function (accounts) {
    let from: Address
    let sr: TestRecipientInstance
    let paymaster: TestPaymasterEverythingAcceptedInstance
    let rhub: RelayHubInstance
    let sm: StakeManagerInstance
    const gasless = accounts[10]
    let relayproc: ChildProcessWithoutNullStreams
    let relayClientConfig: Partial<GSNConfig>

    before(async () => {
      await emptyBalance(gasless, accounts[0])

      const gasPriceFactor = 1.2

      sm = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      const p = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      rhub = await deployHub(sm.address, p.address)
      if (params.relay) {
        relayproc = await startRelay(rhub.address, sm, {
          stake: 1e18,
          delay: 3600 * 24 * 7,
          pctRelayFee: 12,
          url: 'asd',
          relayOwner: accounts[0],
          // @ts-ignore
          ethereumNodeUrl: web3.currentProvider.host,
          gasPriceFactor,
          initialReputation: 100,
          workerTargetBalance: ether('5'),
          value: ether('10'),
          relaylog: process.env.relaylog
        })
        console.log('relay started')
      }

      const forwarder = await Forwarder.new()
      sr = await TestRecipient.new(forwarder.address)

      await registerForwarderForGsn(forwarder)

      paymaster = await TestPaymasterEverythingAccepted.new()
      await paymaster.setTrustedForwarder(forwarder.address)
      await paymaster.setRelayHub(rhub.address)
    })

    after(async function () {
      await stopRelay(relayproc)
    })

    if (params.relay) {
      before(params.title + 'enable relay', async function () {
        // deposit 5 ether, above 'maximumRecipientDeposit'
        for (let i = 0; i < 5; i++) {
          await rhub.depositFor(paymaster.address, { value: (1e18).toString() })
        }

        relayClientConfig = {
          loggerConfiguration: { logLevel: 'error' },
          paymasterAddress: paymaster.address
        }

        const relayProvider = await RelayProvider.newProvider(
          {
            provider: web3.currentProvider as HttpProvider,
            config: relayClientConfig
          }).init()

        // web3.setProvider(relayProvider)

        // NOTE: in real application its enough to set the provider in web3.
        // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
        // so changing the global one is not enough...
        // @ts-ignore
        TestRecipient.web3.setProvider(relayProvider)

        from = gasless
      })
    } else {
      from = accounts[0]
    }

    it(params.title + 'send normal transaction', async () => {
      console.log('running emitMessage (should succeed)')
      let res
      try {
        const gas = await sr.contract.methods.emitMessage('hello').estimateGas()
        res = await sr.emitMessage('hello', { from: from, gas })
      } catch (e) {
        console.log('error is ', e.message)
        throw e
      }
      assert.equal('hello', res.logs[0].args.message)
    })

    it(params.title + 'send gasless transaction', async () => {
      console.log('gasless=' + gasless)

      console.log('running gasless-emitMessage (should fail for direct, succeed for relayed)')
      let ex: Error | undefined
      try {
        const res = await sr.emitMessage('hello, from gasless', { from: gasless, gas: 1e6 })
        console.log('res after gasless emit:', res.logs[0].args.message)
      } catch (e) {
        ex = e
      }

      if (params.relay) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        assert.ok(ex == null, `should succeed sending gasless transaction through relay. got: ${ex?.toString()}`)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string,@typescript-eslint/restrict-template-expressions
        assert.ok(ex!.toString().indexOf('funds') > 0, `Expected Error with 'funds'. got: ${ex?.toString()}`)
      }
    })
    it(params.title + 'running testRevert (should always fail)', async () => {
      await asyncShouldThrow(async () => {
        await sr.testRevert({ from: from })
      }, 'always fail')
    })

    if (params.relay) {
      let approvalPaymaster: TestPaymasterPreconfiguredApprovalInstance
      let relayProvider: RelayProvider

      /**
       * RelayServer has to oversupply gas in order to pass over all the 'remaining gas' checks and give enough gas
       * to the recipient. We are setting 10M as a block gas limit, so cannot go much higher than 9M gas here.
       */
      describe('with different gas limits', function () {
        [1e4, 1e5, 1e6, 1e7]
          .forEach(innerGasLimit =>
            it(`should calculate valid external tx gas limit for a transaction with inner call gas limit of  ${innerGasLimit.toString()}`, async function () {
              const gas = innerGasLimit
              let res: any
              try {
                res = await sr.emitMessageNoParams({ from, gas })
              } catch (e) {
                console.log('error is ', e.message)
                throw e
              }
              const actual: BN = res.logs.find((e: any) => e.event === 'SampleRecipientEmitted').args.gasLeft
              assert.closeTo(actual.toNumber(), innerGasLimit, 1500)
              assert.equal('Method with no parameters', res.logs[0].args.message)
            })
          )
      })

      describe('request with approvaldata', () => {
        before(async function () {
          approvalPaymaster = await TestPaymasterPreconfiguredApproval.new()
          await approvalPaymaster.setRelayHub(rhub.address)
          await approvalPaymaster.setTrustedForwarder(await sr.trustedForwarder())
          await rhub.depositFor(approvalPaymaster.address, { value: (1e18).toString() })
          relayClientConfig = { ...relayClientConfig, ...{ paymasterAddress: approvalPaymaster.address } }
          const relayProvider = await RelayProvider.newProvider(
            {
              provider: web3.currentProvider as HttpProvider,
              config: relayClientConfig
            }).init()
          // @ts-ignore
          TestRecipient.web3.setProvider(relayProvider)
        })

        const setRecipientProvider = async function (asyncApprovalData: AsyncDataCallback): Promise<void> {
          relayProvider =
            await RelayProvider.newProvider({
              provider: web3.currentProvider as HttpProvider,
              config: relayClientConfig,
              overrideDependencies: { asyncApprovalData }
            }).init()
          // @ts-ignore
          TestRecipient.web3.setProvider(relayProvider)
        }

        it(params.title + 'wait for specific approvalData', async () => {
          try {
            await approvalPaymaster.setExpectedApprovalData('0x414243', {
              from: accounts[0],
              // @ts-ignore
              useGSN: false
            })

            await setRecipientProvider(async () => '0x414243')

            await sr.emitMessage('xxx', {
              from: gasless,
              // @ts-ignore - it seems we still allow passing paymaster as a tx parameter
              paymaster: approvalPaymaster.address,
              gas: 1e6
            })
          } catch (e) {
            console.log('error1: ', e)
            throw e
          } finally {
            await approvalPaymaster.setExpectedApprovalData('0x', {
              from: accounts[0],
              // @ts-ignore
              useGSN: false
            })
          }
        })

        it(params.title + 'fail if asyncApprovalData throws', async () => {
          await setRecipientProvider(() => { throw new Error('approval-exception') })
          await asyncShouldThrow(async () => {
            await sr.emitMessage('xxx', {
              from: gasless,
              // @ts-ignore
              paymaster: approvalPaymaster.address
            })
          }, 'approval-exception')
        })

        it(params.title + 'fail on no approval data', async () => {
          try {
            // @ts-ignore
            await approvalPaymaster.setExpectedApprovalData(Buffer.from('hello1'), {
              from: accounts[0],
              useGSN: false
            })
            await asyncShouldThrow(async () => {
              await setRecipientProvider(async () => '0x')

              await sr.emitMessage('xxx', {
                from: gasless
              })
            }, 'unexpected approvalData: \'\' instead of')
          } catch (e) {
            console.log('error3: ', e)
            throw e
          } finally {
            // @ts-ignore
            await approvalPaymaster.setExpectedApprovalData(Buffer.from(''), {
              from: accounts[0],
              useGSN: false
            })
          }
        })
      })
    }

    async function asyncShouldThrow (asyncFunc: () => Promise<any>, str?: string): Promise<void> {
      const msg = str ?? 'Error'
      let ex: Error | undefined
      try {
        await asyncFunc()
      } catch (e) {
        ex = e
      }
      assert.ok(ex != null, `Expected to throw ${msg} but threw nothing`)
      const isExpectedError = ex?.toString().includes(msg)
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      assert.ok(isExpectedError, `Expected to throw ${msg} but threw ${ex?.message}`)
    }
  })
})
