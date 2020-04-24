// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import { RelayProvider } from '../src/relayclient/RelayProvider'

var testutils = require('./TestUtils')

const SampleRecipient = artifacts.require('tests/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('tests/TestPaymasterEverythingAccepted')
const TestPaymasterPreconfiguredApproval = artifacts.require('tests/TestPaymasterPreconfiguredApproval')

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Environments = require('../src/relayclient/types/Environments')

const options = [
  { title: 'Direct-', relay: 0 },
  { title: 'Relayed-', relay: 1 }
]

if (!contract.only) { contract.only = contract }

options.forEach(params => {
  contract(params.title + 'Flow', async (acc) => {
    let from
    let sr
    let paymaster
    let rhub
    let sm
    const accounts = acc
    let gasless
    let relayproc
    let gasPrice
    let relayClientConfig

    before(async () => {
      const gasPricePercent = 20
      gasPrice = (await web3.eth.getGasPrice()) * (100 + gasPricePercent) / 100

      gasless = await web3.eth.personal.newAccount('password')
      web3.eth.personal.unlockAccount(gasless, 'password')

      sm = await StakeManager.new()
      const p = await Penalizer.new()
      rhub = await RelayHub.new(Environments.defaultEnvironment.gtxdatanonzero, sm.address, p.address, { gas: 10000000 })
      if (params.relay) {
        relayproc = await testutils.startRelay(rhub.address, sm, {
          // relaylog:true,
          stake: 1e18,
          delay: 3600 * 24 * 7,
          pctRelayFee: 12,
          url: 'asd',
          relayOwner: accounts[0],
          EthereumNodeUrl: web3.currentProvider.host,
          GasPricePercent: gasPricePercent
        })
        console.log('relay started')
        from = gasless
      } else {
        from = accounts[0]
      }

      sr = await SampleRecipient.new()
      paymaster = await TestPaymasterEverythingAccepted.new()
      await paymaster.setHub(rhub.address)
    })

    after(async function () {
      await testutils.stopRelay(relayproc)
    })

    if (params.relay) {
      before(params.title + 'enable relay', async function () {
        rhub.depositFor(paymaster.address, { value: 1e18 })

        relayClientConfig = {
          relayHubAddress: rhub.address,
          stakeManagerAddress: sm.address,
          paymasterAddress: paymaster.address,
          pctRelayFee: 60,
          // override requested gas price
          force_gasPrice: gasPrice,
          // override requested gas limit.
          force_gasLimit: 100000,
          verbose: process.env.DEBUG
        }

        const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)

        // web3.setProvider(relayProvider)

        // NOTE: in real application its enough to set the provider in web3.
        // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
        // so changing the global one is not enough...
        SampleRecipient.web3.setProvider(relayProvider)
      })
    }

    it(params.title + 'send normal transaction', async () => {
      console.log('running emitMessage (should succeed)')
      let res
      try {
        res = await sr.emitMessage('hello', { from: from })
      } catch (e) {
        console.log('error is ', e.message)
        throw e
      }
      assert.equal('hello', res.logs[0].args.message)
    })

    it(params.title + 'send gasless tranasaction', async () => {
      console.log('gasless=' + gasless)

      console.log('running gasless-emitMessage (should fail for direct, succeed for relayed)')
      let ex
      try {
        const res = await sr.emitMessage('hello, from gasless', { from: gasless })
        console.log('res after gasless emit:', res.logs[0].args.message)
      } catch (e) {
        ex = e
      }

      if (params.relay) {
        assert.ok(ex == null, 'should succeed sending gasless transaction through relay. got: ' + ex)
      } else {
        assert.ok(ex.toString().indexOf('funds') > 0, 'Expected Error with \'funds\'. got: ' + ex)
      }
    })
    it(params.title + 'running testRevert (should always fail)', async () => {
      await asyncShouldThrow(async () => {
        await sr.testRevert({ from: from })
      }, 'revert')
    })

    if (params.relay) {
      let approvalPaymaster

      describe('request with approvaldata', () => {
        let approvalData
        before(async function () {
          approvalPaymaster = await TestPaymasterPreconfiguredApproval.new()
          await approvalPaymaster.setHub(rhub.address)
          await rhub.depositFor(approvalPaymaster.address, { value: 1e18 })

          const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig, { asyncApprovalData: () => Promise.resolve(approvalData) })
          SampleRecipient.web3.setProvider(relayProvider)
        })

        it(params.title + 'wait for specific approvalData', async () => {
          try {
            await approvalPaymaster.setExpectedApprovalData('0x414243', {
              from: accounts[0],
              useGSN: false
            })
            approvalData = '0x414243'
            await sr.emitMessage('xxx', {
              from: gasless,
              paymaster: approvalPaymaster.address
            })
          } catch (e) {
            console.log('error1: ', e)
            throw e
          } finally {
            await approvalPaymaster.setExpectedApprovalData('0x', {
              from: accounts[0],
              useGSN: false
            })
          }
        })

        it(params.title + 'fail on no approval data', async () => {
          try {
            await approvalPaymaster.setExpectedApprovalData(Buffer.from('hello1'), {
              from: accounts[0],
              useGSN: false
            })
            await asyncShouldThrow(async () => {
              approvalData = '0x'
              await sr.emitMessage('xxx', {
                from: gasless,
                paymaster: approvalPaymaster.address
              })
            }, 'unexpected approvalData: \'\' instead of')
          } catch (e) {
            console.log('error3: ', e)
            throw e
          } finally {
            await approvalPaymaster.setExpectedApprovalData(Buffer.from(''), {
              from: accounts[0],
              useGSN: false
            })
          }
        })
      })
    }

    async function asyncShouldThrow (asyncFunc, str) {
      const msg = str || 'Error'
      let ex = null
      try {
        await asyncFunc()
      } catch (e) {
        ex = e
      }
      assert.ok(ex != null, 'Expected to throw ' + msg + ' but threw nothing')
      const isExpectedError = ex.toString().includes(msg) ||
        (ex.otherErrors != null && ex.otherErrors.length > 0 && ex.otherErrors[0].toString().includes(msg))
      assert.ok(isExpectedError, 'Expected to throw ' + msg + ' but threw ' + ex.message)
    }
  }) // of contract
}) // of "foreach"
