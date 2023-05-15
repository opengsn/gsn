import ContractWeb3JS from 'web3-eth-contract'
import Web3 from 'web3'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Contract as ContractV5, Wallet as WalletV5 } from 'ethers'
import { Contract as ContractV6, JsonRpcProvider as JsonRpcProviderV6, Wallet as WalletV6 } from 'ethers-v6'
import { expectEvent } from '@openzeppelin/test-helpers'
import { toChecksumAddress } from 'ethereumjs-util'
import { StaticJsonRpcProvider as StaticJsonRpcProviderV5 } from '@ethersproject/providers'

import { RelayProvider, connectContractToGSN, connectContractV6ToGSN } from '@opengsn/provider'
import { GsnTestEnvironment } from '@opengsn/cli'
import { GSNContractsDeployment } from '@opengsn/common'
import { evmMineMany } from '../TestUtils'

const { expect } = chai.use(chaiAsPromised)

const TestRecipient = artifacts.require('TestRecipient')

const TestRecipientJson = require('../../../cli/src/compiled/TestRecipient.json')

const GANACHE_0_PRIVATE_KEY = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'

/**
 * Test that all kinds of providers users can reasonably pass to the
 */
contract('RelayClient - wrap Providers and Signers', function () {
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
    it('Ethers.js v5 Provider', async function () {
      const ethersV5Provider = new StaticJsonRpcProviderV5(currentTestProviderUrl)
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
      await expectEvent.inLogs(awaited.events, 'SampleRecipientEmitted', {
        realSender: address,
        message: 'Hello Ethers.js v5!'
      })
    })

    it('Ethers.js v5 Signer', async function () {
      const ethersV5Provider = new StaticJsonRpcProviderV5(currentTestProviderUrl)
      const walletV5 = new WalletV5(GANACHE_0_PRIVATE_KEY, ethersV5Provider)
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
      await expectEvent.inLogs(awaited.events, 'SampleRecipientEmitted', {
        realSender: walletAddress,
        message: 'Hello Ethers.js v5 Wallet!'
      })
    })

    it('should throw when attempting to create V6 Provider by wrapping a V5 one', async function () {
      const ethersV5Provider = new StaticJsonRpcProviderV5(currentTestProviderUrl)
      const walletV5 = new WalletV5(GANACHE_0_PRIVATE_KEY, ethersV5Provider)
      const config = {
        paymasterAddress: contractsDeployment.paymasterAddress
      }
      await expect(RelayProvider.newEthersV6Provider({ provider: walletV5, config }))
        .to.be.rejectedWith('Creating Ethers v6 GSN provider with Ethers v5 input is forbidden')
      await expect(RelayProvider.newEthersV6Provider({ provider: ethersV5Provider, config }))
        .to.be.rejectedWith('Creating Ethers v6 GSN provider with Ethers v5 input is forbidden')
    })
  })

  describe('Ethers.js v6', function () {
    it('Ethers.js v6 Provider', async function () {
      const ethersV6Provider = new JsonRpcProviderV6(currentTestProviderUrl)
      const { gsnSigner } = await RelayProvider.newEthersV6Provider({
        provider: ethersV6Provider,
        config: {
          paymasterAddress: contractsDeployment.paymasterAddress
        }
      })
      const testRecipient = new ContractV6(testRecipientAddress, TestRecipientJson.abi, gsnSigner)
      const result = await testRecipient.emitMessage('Hello Ethers.js v6!')
      const awaited = await result.wait()
      const address = await gsnSigner.getAddress()
      // Web3-based OZ library, sorry about that
      await expectEvent.inTransaction(
        awaited.hash,
        new ContractWeb3JS(TestRecipientJson.abi, testRecipientAddress),
        'SampleRecipientEmitted',
        {
          realSender: toChecksumAddress(address),
          message: 'Hello Ethers.js v6!'
        })
    })

    it('Ethers.js v6 Signer', async function () {
      const ethersV6Provider = new JsonRpcProviderV6(currentTestProviderUrl)
      const walletV6 = new WalletV6(GANACHE_0_PRIVATE_KEY, ethersV6Provider)
      const { gsnSigner } = await RelayProvider.newEthersV6Provider({
        provider: walletV6,
        config: {
          paymasterAddress: contractsDeployment.paymasterAddress
        }
      })

      const testRecipient = new ContractV6(testRecipientAddress, TestRecipientJson.abi, gsnSigner)
      const result = await testRecipient.emitMessage('Hello Ethers.js v6!')
      const awaited = await result.wait()
      const address = await gsnSigner.getAddress()
      // Web3-based OZ library, sorry about that
      await expectEvent.inTransaction(
        awaited.hash,
        new ContractWeb3JS(TestRecipientJson.abi, testRecipientAddress),
        'SampleRecipientEmitted',
        {
          realSender: toChecksumAddress(address),
          message: 'Hello Ethers.js v6!'
        })
    })

    it('should throw when attempting to create V5 Provider by wrapping a V6 one', async function () {
      const ethersV6Provider = new JsonRpcProviderV6(currentTestProviderUrl)
      const walletV6 = new WalletV6(GANACHE_0_PRIVATE_KEY, ethersV6Provider)
      const config = {
        paymasterAddress: contractsDeployment.paymasterAddress
      }
      await expect(RelayProvider.newEthersV5Provider({ provider: walletV6, config }))
        .to.be.rejectedWith('Creating Ethers v5 GSN Provider with Ethers v6 input is forbidden')
      await expect(RelayProvider.newEthersV5Provider({ provider: ethersV6Provider, config }))
        .to.be.rejectedWith('Creating Ethers v5 GSN Provider with Ethers v6 input is forbidden')
    })
  })

  describe('wrapping the Signer as input', function () {
    it('eth_accounts should return the one account controlled by the signer', async function () {
      const ethersV5Provider = new StaticJsonRpcProviderV5(currentTestProviderUrl)
      const walletV5 = new WalletV5(GANACHE_0_PRIVATE_KEY, ethersV5Provider)
      const { gsnProvider, gsnSigner } = await RelayProvider.newEthersV5Provider({
        provider: walletV5,
        config: {
          paymasterAddress: contractsDeployment.paymasterAddress
        }
      })
      const signerAddress = await gsnSigner.getAddress()
      const providerAccounts = await gsnProvider.listAccounts()
      assert.equal(providerAccounts.length, 1)
      assert.equal(providerAccounts[0], walletV5.address)
      assert.equal(signerAddress, walletV5.address)
    })
  })

  describe('connecting individual contracts', function () {
    it('should connect an Ethers v5 Contract', async function () {
      this.timeout(30000)
      const ethersV5Provider = new StaticJsonRpcProviderV5(currentTestProviderUrl)
      const walletV5 = new WalletV5(GANACHE_0_PRIVATE_KEY, ethersV5Provider)
      const signerAddress = await walletV5.getAddress()
      const balanceBefore = await web3.eth.getBalance(signerAddress)

      const testRecipient = new ContractV5(testRecipientAddress, TestRecipientJson.abi, walletV5)
      const wrappedGsnRecipient = await connectContractToGSN(testRecipient, { paymasterAddress: contractsDeployment.paymasterAddress })

      await evmMineMany(10) // just give the hardhat and Relay Server some time to "refresh" themselves
      const ret = await wrappedGsnRecipient.emitMessage('Hello Ethers.js v5 Contract!')
      const rcpt = await ret.wait()

      const balanceAfter = await web3.eth.getBalance(signerAddress)
      assert.equal(balanceBefore.toString(), balanceAfter.toString())
      expectEvent.inLogs(rcpt.events, 'SampleRecipientEmitted', {
        realSender: signerAddress,
        message: 'Hello Ethers.js v5 Contract!'
      })
    })

    it('should connect an Ethers v6 Contract', async function () {
      const ethersV6Provider = new JsonRpcProviderV6(currentTestProviderUrl)
      const walletV6 = new WalletV6(GANACHE_0_PRIVATE_KEY, ethersV6Provider)
      const signerAddress = await walletV6.getAddress()
      const testRecipient = new ContractV6(testRecipientAddress, TestRecipientJson.abi, walletV6)

      const wrappedGsnRecipient = await connectContractV6ToGSN(testRecipient, { paymasterAddress: contractsDeployment.paymasterAddress })
      const ret = await (wrappedGsnRecipient as any).emitMessage('Hello Ethers.js v6 Contract!')
      const awaited = await ret.wait()
      // Web3-based OZ library, sorry about that
      await expectEvent.inTransaction(
        awaited.hash,
        new ContractWeb3JS(TestRecipientJson.abi, testRecipientAddress),
        'SampleRecipientEmitted',
        {
          realSender: toChecksumAddress(signerAddress),
          message: 'Hello Ethers.js v6 Contract!'
        })
    })
  })
})
