import { GsnTestEnvironment, TestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { RelayProvider } from '@opengsn/provider'
import { Contract, providers, ContractFactory } from 'ethers'
import 'source-map-support/register'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { wrapContract } from '@opengsn/provider/dist/WrapContract'

const Web3HttpProvider = require('web3-providers-http')

const TestRecipient = require('../../cli/src/compiled/TestRecipient.json')

// eslint-disable-next-line
let NOLOG = true

function logProvider (provider: any): any {
  return {
    send: (sendParams: any, callback: any) => {
      const { method, params } = sendParams
      if (NOLOG || method.match(/eth_getBlockByNumber|eth_call|eth_chainId|net_version/) != null) {
        return provider.send(sendParams, callback)
      }
      console.log('>>> ', method, params)
      provider.send(sendParams, (err: any, ret: any) => {
        console.log('<<< ', method, err, ret)
        callback(err, ret)
      })
    }
  }
}

describe('Ethers client', () => {
  let ethersProvider: providers.Web3Provider
  let gsnRecipient: Contract
  let sender: string
  let env: TestEnvironment

  before(async function () {
    this.timeout(30000)
    const rawProvider = web3.currentProvider as any
    console.log('host=', rawProvider.host, rawProvider.url)
    env = await GsnTestEnvironment.startGsn(rawProvider.host)
    const web3provider = new Web3HttpProvider(rawProvider.host)

    const { paymasterAddress, forwarderAddress } = env.contractsDeployment
    const gsnConfig = {
      paymasterAddress
      // loggerConfiguration: { logLevel: 'error' }
    }
    const rawEthersProvider = new providers.Web3Provider((web3provider))
    const gsnProvider = await RelayProvider.newProvider({
      provider: web3provider,
      config: gsnConfig
    }).init()
    ethersProvider = new providers.Web3Provider(logProvider(gsnProvider))
    sender = gsnProvider.newAccount().address

    const recipient = await new ContractFactory(TestRecipient.abi, TestRecipient.bytecode, rawEthersProvider.getSigner()).deploy(forwarderAddress)
    gsnRecipient = recipient.connect(ethersProvider.getSigner(sender))

    console.log('test deployed at', recipient.address)
  })
  after(async () => {
    await GsnTestEnvironment.stopGsn()
  })

  it('should run command', async function () {
    this.timeout(20000)
    const ret = await gsnRecipient.emitMessage('hello', { gasPrice: 1e9 })
    const rcpt = await ret.wait()
    expectEvent.inLogs(rcpt.events, 'SampleRecipientEmitted', { realSender: sender })
  })
  it('should throw if target transaction fails', async function () {
    this.timeout(20000)
    // must pass gasLimit, to force revert on chain (off-chain revert is handled before reaching GSN)
    await expectRevert(
      gsnRecipient.testRevert({ gasLimit: 1e6, gasPrice: 1e9 }).then((ret: any) => ret.wait()), 'Reported reason: : always fail')
  })

  it('should wrap ethers.js Contract instance with GSN RelayProvider', async function () {
    this.timeout(30000)
    const config = { paymasterAddress: env.contractsDeployment.paymasterAddress }
    const ethersProvider = new providers.JsonRpcProvider((web3.currentProvider as any).host)
    const signer = ethersProvider.getSigner()
    const recipient = await new ContractFactory(TestRecipient.abi, TestRecipient.bytecode, signer).deploy(env.contractsDeployment.forwarderAddress)
    const wrappedGsnRecipient = await wrapContract(recipient, config)
    const signerAddress = await signer.getAddress()
    const balanceBefore = await web3.eth.getBalance(signerAddress)
    const ret = await wrappedGsnRecipient.emitMessage('hello', { gasPrice: 1e9 })
    const rcpt = await ret.wait()
    const balanceAfter = await web3.eth.getBalance(signerAddress)
    assert.equal(balanceBefore.toString(), balanceAfter.toString())
    expectEvent.inLogs(rcpt.events, 'SampleRecipientEmitted', { realSender: signerAddress })
  })
})
