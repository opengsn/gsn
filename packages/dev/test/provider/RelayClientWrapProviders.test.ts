import Web3 from 'web3'
import { RelayProvider } from '@opengsn/provider'
import { GsnTestEnvironment } from '@opengsn/cli'
import { GSNContractsDeployment } from '@opengsn/common'
import { Contract as ContractV5, Wallet as WalletV5 } from 'ethers'
import { Contract as ContractV6 } from 'ethers-v6'
import ContractWeb3JS from 'web3-eth-contract'

import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { wrapContract } from '@opengsn/provider/dist/WrapContract'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { evmMineMany } from '../TestUtils'

const TestRecipient = artifacts.require('TestRecipient')

const TestRecipientJson = require('../../../cli/src/compiled/TestRecipient.json')

/**
 * Test that all kinds of providers users can reasonably pass to the
 */
contract.only('RelayClient - wrap providers / signers', function () {
  const rawProvider = web3.currentProvider as any
  const currentTestProviderUrl = rawProvider.host

  let contractsDeployment: GSNContractsDeployment
  let testRecipientAddress: string

  before(async function () {
    ({ contractsDeployment } = await GsnTestEnvironment.startGsn(currentTestProviderUrl))
    const sr = await TestRecipient.new(contractsDeployment.forwarderAddress!)
    testRecipientAddress = sr.address
  })

  it('Web3.js Provider', async function () {
    const web3provider = new Web3.providers.HttpProvider(currentTestProviderUrl)
    const gsnProvider = await RelayProvider.newWeb3Provider({
      provider: web3provider,
      config: {
        paymasterAddress: contractsDeployment.paymasterAddress
      }
    })

    ContractWeb3JS.setProvider(gsnProvider)
    const testRecipient = new ContractWeb3JS(TestRecipientJson.abi, testRecipientAddress)

    const _web3 = new Web3(gsnProvider)
    const accounts = await _web3.eth.getAccounts()
    await evmMineMany(10) // just give the hardhat and Relay Server some time to "refresh" themselves

    console.log('accounts[0]', accounts[0])
    const result = await testRecipient.methods.emitMessage('Hello Web3.js!').send({ from: accounts[0] })
    // see the event is parsed in Web3.js format
    assert.equal(result.events.SampleRecipientEmitted.returnValues.realSender.toLowerCase(), accounts[0].toLowerCase())
    assert.equal(result.events.SampleRecipientEmitted.returnValues.message, 'Hello Web3.js!')
  })

  describe('Ethers.js v5', function () {
    it('Provider', async function () {
      const ethersV5Provider = new StaticJsonRpcProvider(currentTestProviderUrl)
      const { gsnSigner } = await RelayProvider.newEthersV5Provider({
        provider: ethersV5Provider,
        config: {
          paymasterAddress: contractsDeployment.paymasterAddress
        }
      })

      const testRecipient = new ContractV5(testRecipientAddress, TestRecipientJson.abi, gsnSigner)
      const result = await testRecipient.emitMessage('Hello Ethers.js v5!')
      const awaited = await result.wait()
      const address = await gsnSigner.getAddress()
      expectEvent.inLogs(awaited.events, 'SampleRecipientEmitted', {
        realSender: address,
        message: 'Hello Ethers.js v5!'
      })
    })

    it.only('Signer', async function () {
      const ethersV5Provider = new StaticJsonRpcProvider(currentTestProviderUrl)
      const walletV5 = new WalletV5('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d', ethersV5Provider)
      const { gsnSigner } = await RelayProvider.newEthersV5Provider({
        provider: walletV5,
        config: {
          paymasterAddress: contractsDeployment.paymasterAddress
        }
      })

      const testRecipient = new ContractV5(testRecipientAddress, TestRecipientJson.abi, gsnSigner)
      const result = await testRecipient.emitMessage('Hello Ethers.js v5 Wallet!')
      const awaited = await result.wait()
      const walletAddress = await walletV5.getAddress()
      expectEvent.inLogs(awaited.events, 'SampleRecipientEmitted', {
        realSender: walletAddress,
        message: 'Hello Ethers.js v5 Wallet!'
      })
    })
  })

  it('Ethers.js v6 Signer')
  it('Ethers.js v6 Provider')

  it('should wrap ethers.js Contract instance with GSN RelayProvider and return a connected Ethers.js v5 Contract',
    async function () {
      this.timeout(30000)
      const ethersProvider = new StaticJsonRpcProvider(currentTestProviderUrl)
      const signer = ethersProvider.getSigner()
      const signerAddress = await signer.getAddress()
      const balanceBefore = await web3.eth.getBalance(signerAddress)

      const testRecipient = new ContractV5(testRecipientAddress, TestRecipientJson.abi, signer)
      const wrappedGsnRecipient = await wrapContract(testRecipient, { paymasterAddress: contractsDeployment.paymasterAddress })

      const ret = await wrappedGsnRecipient.emitMessage('hello', { gasPrice: 1e9 })
      const rcpt = await ret.wait()

      const balanceAfter = await web3.eth.getBalance(signerAddress)
      assert.equal(balanceBefore.toString(), balanceAfter.toString())
      expectEvent.inLogs(rcpt.events, 'SampleRecipientEmitted', { realSender: signerAddress })
    })
})
