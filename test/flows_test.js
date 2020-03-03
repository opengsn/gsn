// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

var testutils = require('./testutils.js')

const SampleRecipient = artifacts.require('tests/TestRecipient')
const TestSponsor = artifacts.require('tests/TestSponsorEverythingAccepted')
const TestSponsorApproval = artifacts.require('tests/TestSponsorPreconfiguredApproval')

const RelayHub = artifacts.require('RelayHub')

const RelayProvider = require('../src/js/relayclient/RelayProvider')
const Environments = require('../src/js/relayclient/Environments')

const options = [
  { title: 'Direct-', relay: 0 },
  { title: 'Relayed-', relay: 1 }
]

options.forEach(params => {
  contract(params.title + 'Flow', async (acc) => {
    let from
    let sr
    let gasSponsor
    let rhub
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

      if (params.relay) {
        // rhub = await RelayHub.deployed()
        rhub = await RelayHub.new(Environments.istanbul.gtxdatanonzero, { gas: 10000000 })
        relayproc = await testutils.startRelay(rhub, {
          stake: 1e18,
          delay: 3600 * 24 * 7,
          txfee: 12,
          url: 'asd',
          relayOwner: accounts[0],
          EthereumNodeUrl: web3.currentProvider.host,
          GasPricePercent: gasPricePercent
        })
        console.log('relay started')
        from = gasless
      } else {
        from = accounts[0]
        // dummy relay hub. direct mode doesn't use it, but our SampleRecipient contract requires one.
        rhub = await RelayHub.deployed()
      }

      sr = await SampleRecipient.new()
      gasSponsor = await TestSponsor.new()
      await sr.setHub(rhub.address)
      await gasSponsor.setHub(rhub.address)
    })

    after(async function () {
      await testutils.stopRelay(relayproc)
    })

    if (params.relay) {
      it(params.title + 'enable relay', async function () {
        rhub.depositFor(gasSponsor.address, { value: 1e18 })

        relayClientConfig = {
          txfee: 60,
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
      console.log('running emitMessage (should succeed')
      const res = await sr.emitMessage('hello', { from: from, gasSponsor: gasSponsor.address })
      assert.equal('hello', res.logs[0].args.message)
    })

    it(params.title + 'send gasless tranasaction', async () => {
      console.log('gasless=' + gasless)

      console.log('running gasless-emitMessage (should fail for direct, succeed for relayed')
      let ex
      try {
        const res = await sr.emitMessage('hello, from gasless', { from: gasless, gasSponsor: gasSponsor.address })
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
        await sr.testRevert({ from: from, gasSponsor: gasSponsor.address })
      }, 'revert')
    })

    if (params.relay) {
      let approvalSponsor

      before(async function () {
        approvalSponsor = await TestSponsorApproval.new()
        await approvalSponsor.setHub(rhub.address)
        await rhub.depositFor(approvalSponsor.address, { value: 1e18 })
      })

      it(params.title + 'wait for specific approvalData', async () => {
        try {
          await approvalSponsor.setExpectedApprovalData('0x414243', { from: accounts[0], useGSN: false })
          await sr.emitMessage('xxx', { from: gasless, approvalData: '0x414243', gasSponsor: approvalSponsor.address })
        } catch (e) {
          console.log('error1: ', e)
          throw e
        } finally {
          await approvalSponsor.setExpectedApprovalData(Buffer.from(''), { from: accounts[0], useGSN: false })
        }
      })

      it(params.title + 'wait for specific approvalData as Buffer', async () => {
        try {
          await approvalSponsor.setExpectedApprovalData(Buffer.from('hello'), { from: accounts[0], useGSN: false })
          SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = true
          await sr.emitMessage('xxx', {
            from: gasless,
            approvalData: Buffer.from('hello'),
            gasSponsor: approvalSponsor.address
          })
        } catch (e) {
          console.log('error2: ', e)
          throw e
        } finally {
          await approvalSponsor.setExpectedApprovalData(Buffer.from(''), { from: accounts[0], useGSN: false })
        }
      })

      it(params.title + 'fail on no approval data', async () => {
        try {
          await approvalSponsor.setExpectedApprovalData(Buffer.from('hello1'), { from: accounts[0], useGSN: false })
          await asyncShouldThrow(async () => {
            await sr.emitMessage('xxx', { from: gasless, gasSponsor: approvalSponsor.address })
          }, 'unexpected approvalData: \'\' instead of')
        } catch (e) {
          console.log('error3: ', e)
          throw e
        } finally {
          await approvalSponsor.setExpectedApprovalData(Buffer.from(''), { from: accounts[0], useGSN: false })
        }
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
