/* eslint-disable no-global-assign */

import BN from 'bn.js'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { toBuffer, PrefixedHexString } from 'ethereumjs-util'

import {
  ContractInteractor,
  ForwardRequest,
  GSNContractsDeployment,
  RelayData,
  RelayRequest,
  TypedRequestData,
  constants,
  defaultEnvironment,
  getEip712Signature,
  splitRelayUrlForRegistrar
} from '@opengsn/common'

import {
  RelayHubInstance,
  PenalizerInstance,
  StakeManagerInstance,
  TestRecipientInstance,
  ForwarderInstance,
  TestPaymasterConfigurableMisbehaviorInstance, RelayRegistrarInstance, TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'

import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'

import { deployHub, encodeRevertReason } from './TestUtils'
import { defaultGsnConfig } from '@opengsn/provider'

const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const Forwarder = artifacts.require('Forwarder')
const Penalizer = artifacts.require('Penalizer')
const TestUtil = artifacts.require('TestUtil')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const RelayRegistrar = artifacts.require('RelayRegistrar')

const contractOrig = contract
if (process.env.GAS_CALCULATIONS == null) {
  // @ts-ignore
  contract = contract.skip
}

interface PartialRelayRequest {
  request?: Partial<ForwardRequest>
  relayData?: Partial<RelayData>
}

// given partial request, fill it in from defaults, and return request and signature to send.
// if nonce is not explicitly specified, read it from forwarder
async function makeRequest (
  web3: Web3,
  req: PartialRelayRequest,
  defaultRequest: RelayRequest,
  chainId: number,
  forwarderInstance: ForwarderInstance,
  relayHubInstance: RelayHubInstance): Promise<{ req: RelayRequest, sig: PrefixedHexString }> {
  const filledRequest = {
    request: { ...defaultRequest.request, ...req.request },
    relayData: { ...defaultRequest.relayData, ...req.relayData }
  }
  // unless explicitly set, read nonce from network.
  if ((filledRequest.request.nonce ?? '0') === '0') {
    filledRequest.request.nonce = (await forwarderInstance.getNonce(filledRequest.request.from)).toString()
  }
  const deployment: GSNContractsDeployment = {
    relayHubAddress: relayHubInstance.address
  }
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const provider = new StaticJsonRpcProvider(currentProviderHost)
  const contractInteractor = new ContractInteractor({
    domainSeparatorName: defaultGsnConfig.domainSeparatorName,
    environment: defaultEnvironment,
    provider,
    logger: createServerLogger('error', '', ''),
    deployment,
    maxPageSize: Number.MAX_SAFE_INTEGER
  })
  await contractInteractor.init()
  filledRequest.relayData.transactionCalldataGasUsed =
    await contractInteractor.estimateCalldataCostForRequest(filledRequest, {
      maxApprovalDataLength: 0,
      maxPaymasterDataLength: 0
    })

  const sig = await getEip712Signature(
    provider.getSigner(filledRequest.request.from),
    new TypedRequestData(
      defaultGsnConfig.domainSeparatorName,
      chainId,
      filledRequest.relayData.forwarder,
      filledRequest
    )
  )
  return {
    req: filledRequest,
    sig
  }
}

// verify the paymaster's commitment:
// - PM always pay for non-reverted TXs (either high or low gas use)
// - if preRelayedCall reverts: PM always pay (=as long as commitment>preRelayedCallGasLimit)
// - standard forwarder reverts: PM always pay (since commitment > gas of (preRelayedCall,forwarder))
// - nonstandard forwarder: PM pays above commitment
// - trusted recipient: PM pays above commitment.
contract('Paymaster Commitment', function ([_, relayOwner, relayManager, relayWorker, senderAddress, other]) { // eslint-disable-line no-unused-vars
  const RelayCallStatusCodes = {
    OK: new BN('0'),
    RelayedCallFailed: new BN('1'),
    RejectedByPreRelayed: new BN('2'),
    RejectedByForwarder: new BN('3'),
    RejectedByRecipientRevert: new BN('4'),
    PostRelayedFailed: new BN('5'),
    PaymasterBalanceChanged: new BN('6')
  }

  let chainId: number

  let relayHub: string
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let relayHubInstance: RelayHubInstance
  let relayRegistrar: RelayRegistrarInstance
  let testToken: TestTokenInstance

  let recipientContract: TestRecipientInstance
  let paymasterContract: TestPaymasterConfigurableMisbehaviorInstance
  let forwarderInstance: ForwarderInstance
  let target: string
  let paymaster: string
  let forwarder: string

  before(async function () {
    const stake = ether('2')
    testToken = await TestToken.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    relayHubInstance = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
    relayRegistrar = await RelayRegistrar.at(await relayHubInstance.getRelayRegistrar())

    forwarderInstance = await Forwarder.new()
    forwarder = forwarderInstance.address
    recipientContract = await TestRecipient.new(forwarder)

    const testUtil = await TestUtil.new()
    chainId = (await testUtil.libGetChainID()).toNumber()

    await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarderInstance)

    target = recipientContract.address
    relayHub = relayHubInstance.address

    await testToken.mint(stake, { from: relayOwner })
    await testToken.approve(stakeManager.address, stake, { from: relayOwner })
    // await relayHubInstance.setMinimumStakes([testToken.address], [stake])

    await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
    await stakeManager.stakeForRelayManager(testToken.address, relayManager, 15000, stake, {
      from: relayOwner
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub, { from: relayOwner })

    await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
    await relayRegistrar.registerRelayServer(relayHub, splitRelayUrlForRegistrar('url'), { from: relayManager })
  })

  describe('paymaster commitments', function () {
    const gasPrice = 1e9.toString()
    const gasLimit = '1000000'
    const senderNonce = '0'
    let sharedRelayRequestData: RelayRequest
    const paymasterData = '0x'
    const clientId = '1'
    const externalGasLimit = 5e6

    beforeEach(async () => {
      // brand new paymaster for each test...
      paymasterContract = await TestPaymasterConfigurableMisbehavior.new()
      paymaster = paymasterContract.address
      await paymasterContract.setTrustedForwarder(forwarder)
      await paymasterContract.setRelayHub(relayHub)
      await relayHubInstance.depositFor(paymaster, {
        value: ether('1'),
        from: other
      })

      sharedRelayRequestData = {
        request: {
          to: target,
          data: '',
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          validUntilTime: '0'
        },
        relayData: {
          transactionCalldataGasUsed: '0',
          maxFeePerGas: '1',
          maxPriorityFeePerGas: '1',
          relayWorker,
          forwarder,
          paymaster,
          paymasterData,
          clientId
        }
      }
    })

    let paymasterBalance: BN
    beforeEach(async () => {
      paymasterBalance = (await relayHubInstance.balanceOf(paymaster))
    })

    it('paymaster should pay for normal request', async () => {
      const r = await makeRequest(web3, {
        request: {
          // nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })
      // gasPrice is '1', so price=gasUsed...
      expectEvent(res, 'TransactionRelayed', { status: '0' })

      const paid = paymasterBalance.sub(await relayHubInstance.balanceOf(paymaster)).toNumber()
      // console.log('actual paid=', paid, 'gasUsed=', gasUsed, 'diff=', paid - gasUsed)
      assert.closeTo(paid, res.receipt.gasUsed, 100)
    })

    it('paymaster should not pay for requests exceeding msg.data size limit', async () => {
      const r = await makeRequest(web3, {
        request: {
          // nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)
      const gasAndDataLimits = await paymasterContract.getGasAndDataLimits()
      // @ts-ignore
      const hugeApprovalData = '0x' + 'ef'.repeat(parseInt(gasAndDataLimits.calldataSizeLimit))
      await expectRevert(
        relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, hugeApprovalData, {
          from: relayWorker,
          gas: externalGasLimit,
          gasPrice
        }), 'msg.data exceeded limit'
      )
    })

    it('paymaster should not pay for requests with max msg.data size if it rejects in pre', async () => {
      await paymasterContract.setRevertPreRelayCall(true)
      const r = await makeRequest(web3, {
        request: {
          // nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const gasAndDataLimits = await paymasterContract.getGasAndDataLimits()
      // @ts-ignore
      const hugeApprovalData = '0x' + 'ef'.repeat(parseInt(gasAndDataLimits.calldataSizeLimit) - 1094)
      const relayCallParams: [string, number, RelayRequest, string, string, Truffle.TransactionDetails?] = [defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, hugeApprovalData]
      const method = relayHubInstance.contract.methods.relayCall(...relayCallParams)
      // @ts-ignore
      assert.equal(gasAndDataLimits.calldataSizeLimit, toBuffer(method.encodeABI()).length.toString(),
        'relayCall() msg.data should be set to max size')
      const txdetails: Truffle.TransactionDetails = {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      }
      relayCallParams.push(txdetails)
      const res = await relayHubInstance.relayCall(...relayCallParams)
      expectEvent(res, 'TransactionRejectedByPaymaster', { reason: encodeRevertReason('You asked me to revert, remember?') })
    })

    it('paymaster should not pay for requests with max msg.data size if it accepts in pre but forwarder fails', async () => {
      const r = await makeRequest(web3, {
        request: {
          nonce: '11141212',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const gasAndDataLimits = await paymasterContract.getGasAndDataLimits()
      // @ts-ignore
      const hugeApprovalData = '0x' + 'ef'.repeat(parseInt(gasAndDataLimits.calldataSizeLimit) - 1094)
      const relayCallParams: [string, number, RelayRequest, string, string, Truffle.TransactionDetails?] = [defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, hugeApprovalData]
      const method = relayHubInstance.contract.methods.relayCall(...relayCallParams)
      // @ts-ignore
      assert.equal(gasAndDataLimits.calldataSizeLimit, toBuffer(method.encodeABI()).length.toString(),
        'relayCall() msg.data should be set to max size')
      const txdetails: Truffle.TransactionDetails = {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      }
      relayCallParams.push(txdetails)
      const res = await relayHubInstance.relayCall(...relayCallParams)
      expectEvent(res, 'TransactionRejectedByPaymaster', { reason: encodeRevertReason('FWD: nonce mismatch') })
    })

    it('paymaster should not change its acceptanceBudget before transaction', async () => {
      // the protocol of the relay to perform a view function of relayCall(), and then
      // issue it on-chain.
      // this test comes to verify the paymaster didn't change its acceptanceBalance between these
      // calls to a higher value.
      // it is assumed that the relay already made the view function and validated the acceptanceBalance to
      // be small, and now making a 2nd call on-chain, but with the acceptanceBalance as parameter.
      // the RELAYER (not paymaster) will pay for this reject - but at least it is very small, as it is
      // "fails-fast", as one of the first validation tests in relayCall
      const r = await makeRequest(web3, {
        request: {
          // nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const gasLimits = await paymasterContract.getGasAndDataLimits()
      // @ts-ignore
      const maxAcceptanceBudget = parseInt(gasLimits.acceptanceBudget)
      // fail if a bit lower
      expectRevert(relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, maxAcceptanceBudget - 1, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      }), 'acceptance budget too high')

      // but succeed if the value is OK
      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, maxAcceptanceBudget, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })
      expectEvent(res, 'TransactionRelayed', { status: '0' })
    })

    it('2nd payment should be 15k cheaper for relay than paymaster', async () => {
      // we can't do much about it: gasleft doesn't take into account "refunds", so
      //  we charge paymaster for reported gas, even though the evm will refund (the relay)
      //  at the end for some of it.
      //  if the paymaster's pre/post calls cause more refund, it will ALSO benefit the relayer, not the paymaster.
      //  NOTE: this means that
      //  GAS TOKENS CAN'T BE USED BY PAYMASTER - unless it is the same owner of relay and paymaster,

      const r = await makeRequest(web3, {
        request: {
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        }
      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })
      // gasPrice is '1', so price=gasUsed...
      const gasUsed = res.receipt.gasUsed
      expectEvent(res, 'TransactionRelayed', { status: '0' })

      const paymasterPaid = paymasterBalance.sub(await relayHubInstance.balanceOf(paymaster)).toNumber()
      // TODO understand why there's a 2100 gas decrease (cost of sload?)
      assert.closeTo(paymasterPaid - parseInt(gasUsed), 17100, 100)
    })

    it('paymaster should not have preRelayedCall gas limit > acceptance budget', async () => {
      const limits = await paymasterContract.getGasAndDataLimits()
      await paymasterContract.setGasLimits(
        limits.acceptanceBudget,
        // @ts-ignore
        parseInt(limits.preRelayedCallGasLimit) + parseInt(limits.acceptanceBudget),
        limits.postRelayedCallGasLimit
      )
      const r = await makeRequest(web3, {
        request: {
          // nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      expectRevert(relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      }), 'acceptance budget too low')
    })

    it('paymaster should not pay for reverts in preRelayedCall under acceptance budget', async () => {
      await paymasterContract.setOutOfGasPre(true)
      const r = await makeRequest(web3, {
        request: {
          // nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })

      expectEvent(res, 'TransactionRejectedByPaymaster', { reason: null })

      const paid = paymasterBalance.sub(await relayHubInstance.balanceOf(paymaster)).toNumber()
      assert.equal(paid, 0)
    })

    it('paymaster should not pay for Forwarder revert (under commitment gas)', async () => {
      // NOTE: as long as commitment > preRelayedCallGasLimit
      const r = await makeRequest(web3, {
        request: {
          nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })

      expectEvent(res, 'TransactionRejectedByPaymaster', { reason: encodeRevertReason('FWD: nonce mismatch') })

      const paid = paymasterBalance.sub(await relayHubInstance.balanceOf(paymaster)).toNumber()
      assert.equal(paid, 0)
    })

    it('paymaster SHOULD pay for Forwarder revert ABOVE commitment', async () => {
      // instead of creating a custom forwarder with takes a lot of gas, we lower
      // the commitment, so normal paymaster will be above it.
      // TODO fix this voodoo
      await paymasterContract.setGasLimits(15000, 15000, 12000)

      // NOTE: as long as commitment > preRelayedCallGasLimit
      const r = await makeRequest(web3, {
        request: {
          nonce: '4',
          data: recipientContract.contract.methods.emitMessage('').encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })

      expectEvent(res, 'TransactionRelayed', { status: RelayCallStatusCodes.RejectedByForwarder })
    })

    it('paymaster should not pay for trusted-recipient revert (within commitment)', async () => {
      await paymasterContract.setTrustRecipientRevert(true)
      const r = await makeRequest(web3, {
        request: {
          data: recipientContract.contract.methods.testRevert().encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })

      expectEvent(res, 'TransactionRejectedByPaymaster', { reason: encodeRevertReason('always fail') })

      const paid = paymasterBalance.sub(await relayHubInstance.balanceOf(paymaster)).toNumber()
      assert.equal(paid, 0)
    })

    it('paymaster SHOULD pay for trusted-recipient revert (above commitment)', async () => {
      // TODO fix this voodoo
      await paymasterContract.setGasLimits(15000, 15000, 12000)

      await paymasterContract.setTrustRecipientRevert(true)
      const r = await makeRequest(web3, {
        request: {
          data: recipientContract.contract.methods.testRevert().encodeABI()
        },
        relayData: { paymaster }

      }, sharedRelayRequestData, chainId, forwarderInstance, relayHubInstance)

      const res = await relayHubInstance.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, r.req, r.sig, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice
      })

      expectEvent(res, 'TransactionRelayed', { status: RelayCallStatusCodes.RejectedByRecipientRevert })
    })
  })
})

// @ts-ignore
contract = contractOrig
