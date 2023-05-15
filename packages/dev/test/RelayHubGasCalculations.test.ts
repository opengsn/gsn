/* eslint-disable no-global-assign */

import BN from 'bn.js'
import { ether } from '@openzeppelin/test-helpers'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

import {
  getEip712Signature
} from '@opengsn/common/dist/Utils'
import {
  ContractInteractor,
  GSNContractsDeployment,
  RelayCallStatusCodes,
  RelayData,
  RelayHubConfiguration,
  RelayRequest,
  TypedRequestData,
  cloneRelayRequest,
  constants,
  defaultEnvironment,
  splitRelayUrlForRegistrar,
  toNumber
} from '@opengsn/common'

import {
  RelayHubInstance,
  TestRecipientInstance,
  TestPaymasterVariableGasLimitsInstance,
  StakeManagerInstance,
  IForwarderInstance,
  PenalizerInstance,
  RelayRegistrarInstance,
  TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { deployHub, hardhatNodeChainId, revert, snapshot } from './TestUtils'

import { createClientLogger } from '@opengsn/logger/dist/ClientWinstonLogger'
import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'
import { toBN } from 'web3-utils'

import * as process from 'process'
import { defaultGsnConfig } from '@opengsn/provider'

const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestToken = artifacts.require('TestToken')
const TestRelayHub = artifacts.require('TestRelayHub')
const TestPaymasterVariableGasLimits = artifacts.require('TestPaymasterVariableGasLimits')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const RelayRegistrar = artifacts.require('RelayRegistrar')

const contractOrig = contract
if (process.env.GAS_CALCULATIONS == null) {
  // @ts-ignore
  contract = contract.skip
}

contract('RelayHub gas calculations', function ([_, relayOwner, relayWorker, relayManager, senderAddress, other]) {
  const message = 'Gas Calculations'
  const unstakeDelay = 15000
  const chainId = hardhatNodeChainId
  const gasPrice = new BN(1e9)
  const maxFeePerGas = 1e9.toString()
  const maxPriorityFeePerGas = 1e9.toString()
  const gasLimit = new BN('1000000')
  const externalGasLimit = 5e6.toString()
  const paymasterData = '0x'
  const clientId = '1'
  const devAddress = '0xeFEfeFEfeFeFEFEFEfefeFeFefEfEfEfeFEFEFEf'
  const stake = ether('2')

  const senderNonce = new BN('0')

  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  let relayHub: RelayHubInstance
  let relayRegistrar: RelayRegistrarInstance

  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let paymaster: TestPaymasterVariableGasLimitsInstance
  let forwarderInstance: IForwarderInstance
  let testToken: TestTokenInstance
  let encodedFunction
  let signature: string
  let relayRequest: RelayRequest
  let forwarder: string
  let contractInteractor: ContractInteractor

  async function prepareForHub (config: Partial<RelayHubConfiguration> = {}): Promise<void> {
    testToken = await TestToken.new()
    forwarderInstance = await Forwarder.new()
    forwarder = forwarderInstance.address
    recipient = await TestRecipient.new(forwarder)
    paymaster = await TestPaymasterVariableGasLimits.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString(), config, defaultEnvironment, TestRelayHub)
    relayRegistrar = await RelayRegistrar.at(await relayHub.getRelayRegistrar())

    await paymaster.setTrustedForwarder(forwarder)
    await paymaster.setRelayHub(relayHub.address)
    // register hub's RelayRequest with forwarder, if not already done.
    await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarderInstance)

    await relayHub.depositFor(paymaster.address, {
      value: ether('1'),
      from: other
    })
    await relayHub.depositFor(devAddress, {
      value: (1).toString()
    })

    await testToken.mint(stake, { from: relayOwner })
    await testToken.approve(stakeManager.address, stake, { from: relayOwner })
    await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
    await stakeManager.stakeForRelayManager(testToken.address, relayManager, unstakeDelay, stake, {
      from: relayOwner
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar(''), { from: relayManager })

    encodedFunction = recipient.contract.methods.emitMessage(message).encodeABI()
    relayRequest = {
      request: {
        to: recipient.address,
        data: encodedFunction,
        from: senderAddress,
        nonce: senderNonce.toString(),
        value: '0',
        gas: gasLimit.toString(),
        validUntilTime: '0'
      },
      relayData: {
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        transactionCalldataGasUsed: '0',
        relayWorker,
        forwarder,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }

    }
    const dataToSign = new TypedRequestData(
      defaultGsnConfig.domainSeparatorName,
      chainId,
      forwarder,
      relayRequest
    )
    signature = await getEip712Signature(
      ethersProvider.getSigner(senderAddress),
      dataToSign
    )

    const maxPageSize = Number.MAX_SAFE_INTEGER
    const logger = createClientLogger({ logLevel: 'error' })
    const deployment: GSNContractsDeployment = { paymasterAddress: paymaster.address }
    contractInteractor = new ContractInteractor({
      domainSeparatorName: defaultGsnConfig.domainSeparatorName,
      environment: defaultEnvironment,
      provider: ethersProvider,
      logger,
      maxPageSize,
      deployment
    })
    await contractInteractor.init()
  }

  beforeEach(prepareForHub)

  describe('#calculateCharge()', function () {
    [[1e9, 1e9, 1e9], [1e9, 1e10, 1e10], [1e9, 1e9, 1e10], [1e10, 1e9, 1e10], [1e9, 1e10, 1e11], [1e11, 1e10, 1e9], [1e10, 1e9, 1e11], [1e9, 1e11, 1e10]]
      .forEach(([maxFeePerGas, maxPriorityFeePerGas, gasPrice]) => {
        it('should calculate charge correctly', async function () {
          const gasUsed = 1e8
          const baseRelayFee = 1000000
          const pctRelayFee = 10
          const config = Object.assign({}, defaultEnvironment.relayHubConfiguration, { baseRelayFee, pctRelayFee })
          await relayHub.setConfiguration(config)
          const relayData: RelayData = {
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
            transactionCalldataGasUsed: '0',
            relayWorker,
            forwarder,
            paymaster: paymaster.address,
            paymasterData,
            clientId
          }
          // Hardhat always has block.basefee == 0 on eth_call https://github.com/nomiclabs/hardhat/issues/1688
          const baseFeePerGas = 0
          const charge = await relayHub.calculateCharge(gasUsed.toString(), relayData, { gasPrice })
          const chargeableGasPrice = Math.min(maxFeePerGas, gasPrice, maxPriorityFeePerGas + baseFeePerGas)
          const expectedCharge = baseRelayFee + gasUsed * chargeableGasPrice * (pctRelayFee + 100) / 100
          assert.equal(charge.toString(), expectedCharge.toString())
        })
      })
  })

  describe('#relayCall()', function () {
    // note: since adding the revert reason to the emit, post overhead is dynamic
    it('should set correct gas limits and pass correct \'gasUsedWithoutPost\' to the \'postRelayCall\'', async () => {
      const gasPrice = 1e9
      const estimatePostGas = (await paymaster.postRelayedCall.estimateGas('0x', true, '0x0', {
        maxFeePerGas,
        maxPriorityFeePerGas,
        transactionCalldataGasUsed: '0',
        relayWorker,
        forwarder,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }, { from: relayHub.address })) - 21000

      const externalGasLimit = 5e6
      const tx = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
        from: relayWorker,
        gas: externalGasLimit.toString(),
        gasPrice
      })

      const pmlogs = await paymaster.contract.getPastEvents()
      const pmPostLog = pmlogs.find((e: any) => e.event === 'SampleRecipientPostCallWithValues')

      const gasUseWithoutPost = parseInt(pmPostLog.returnValues.gasUseWithoutPost)
      const usedGas = parseInt(tx.receipt.gasUsed)
      assert.closeTo(gasUseWithoutPost, usedGas - estimatePostGas, 100,
        `postOverhead: increase by ${usedGas - estimatePostGas - gasUseWithoutPost}\
        \n\tpostOverhead: ${toNumber(defaultEnvironment.relayHubConfiguration.postOverhead) + usedGas - estimatePostGas - gasUseWithoutPost},\n`
      )
    })

    it('should revert an attempt to use more than allowed gas for preRelayedCall', async function () {
      // TODO: extract preparation to 'before' block
      const misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await misbehavingPaymaster.setTrustedForwarder(forwarder)
      await misbehavingPaymaster.setRelayHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: ether('0.1') })
      await misbehavingPaymaster.setOutOfGasPre(true)

      const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
      const relayRequestMisbehaving = cloneRelayRequest(relayRequest)
      relayRequestMisbehaving.relayData.paymaster = misbehavingPaymaster.address
      relayRequestMisbehaving.request.nonce = senderNonce
      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        chainId,
        forwarder,
        relayRequestMisbehaving
      )
      const signature = await getEip712Signature(
        ethersProvider.getSigner(senderAddress),
        dataToSign
      )
      const viewRelayCallResponse =
        await relayHub.contract.methods
          .relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequestMisbehaving, signature, '0x')
          .call({
            from: relayRequestMisbehaving.relayData.relayWorker,
            gas: externalGasLimit,
            gasPrice: 1e9
          })
      assert.equal(viewRelayCallResponse[0], false)
      assert.equal(viewRelayCallResponse[2], RelayCallStatusCodes.RejectedByPreRelayed.toString())
      assert.equal(viewRelayCallResponse[3], null) // no revert string on out-of-gas

      const res = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequestMisbehaving, signature, '0x', {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice: gasPrice
      })

      assert.equal('TransactionRejectedByPaymaster', res.logs[0].event)
      // @ts-ignore
      assert.equal(res.logs[0].args.reason, null)
    })
  })

  async function getBalances (): Promise<{
    paymasters: BN
    relayWorkers: BN
    relayManagers: BN
    devs: BN
  }> {
    const paymasters = await relayHub.balanceOf(paymaster.address)
    // @ts-ignore
    const relayWorkers = new BN(await web3.eth.getBalance(relayWorker))
    const relayManagers = await relayHub.balanceOf(relayManager)
    const devs = await relayHub.balanceOf(devAddress)
    return {
      paymasters,
      relayWorkers,
      relayManagers,
      devs
    }
  }

  async function diffBalances (startBalances: {
    paymasters: BN
    relayWorkers: BN
    relayManagers: BN
  }):
    Promise<{
      paymasters: BN
      relayWorkers: BN
      relayManagers: BN
    }> {
    const balances = await getBalances()
    return {
      paymasters: startBalances.paymasters.sub(balances.paymasters),
      relayWorkers: startBalances.relayWorkers.sub(balances.relayWorkers),
      relayManagers: startBalances.relayManagers.sub(balances.relayManagers)
    }
  }

  function logOverhead (weiActualCharge: BN, workerGasUsed: BN, calldataOverchargeWei: BN): void {
    const gasDiff = workerGasUsed.add(calldataOverchargeWei).sub(weiActualCharge).div(gasPrice).toString()
    if (gasDiff !== '0') {
      console.log('== zero-fee unmatched gas. RelayHubConfiguration.gasOverhead should be increased by: ' + gasDiff.toString())
      const fixedGasOverhead =
        toNumber(defaultEnvironment.relayHubConfiguration.gasOverhead) +
        parseInt(gasDiff)
      console.log(`=== fixed:\n\tgasOverhead: ${fixedGasOverhead},\n`)
    }
  }

  context('charge calculation should not depend on return/revert value of request', () => {
    [[true, 0], [true, 20], [false, 0], [false, 50]]
      .forEach(([doRevert, len]) => {
        it(`should calculate overhead regardless of return value len (${len}) or revert (${doRevert})`, async () => {
          const beforeBalances = await getBalances()
          const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
          let encodedFunction
          if (len === 0) {
            encodedFunction = recipient.contract.methods.checkNoReturnValues(doRevert).encodeABI()
          } else {
            encodedFunction = recipient.contract.methods.checkReturnValues(len, doRevert).encodeABI()
          }
          const relayRequest: RelayRequest = {
            request: {
              to: recipient.address,
              data: encodedFunction,
              from: senderAddress,
              nonce: senderNonce,
              value: '0',
              gas: gasLimit.toString(),
              validUntilTime: '0'
            },
            relayData: {
              maxFeePerGas: '1',
              maxPriorityFeePerGas: '1',
              transactionCalldataGasUsed: '0',
              relayWorker,
              forwarder,
              paymaster: paymaster.address,
              paymasterData,
              clientId
            }
          }
          relayRequest.relayData.transactionCalldataGasUsed = await contractInteractor.estimateCalldataCostForRequest(relayRequest, {
            maxPaymasterDataLength: 0,
            maxApprovalDataLength: 0
          })
          const dataToSign = new TypedRequestData(
            defaultGsnConfig.domainSeparatorName,
            chainId,
            forwarder,
            relayRequest
          )
          const signature = await getEip712Signature(
            ethersProvider.getSigner(senderAddress),
            dataToSign
          )
          const res = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
            from: relayWorker,
            gas: externalGasLimit,
            gasPrice: gasPrice
          })

          const encodedData = contractInteractor.encodeABI({
            domainSeparatorName: defaultGsnConfig.domainSeparatorName,
            maxAcceptanceBudget: 10e6.toString(),
            relayRequest,
            signature,
            approvalData: '0x'
          })
          // As there can be some discrepancy between estimation and actual cost (zeroes in signature, etc.)
          // we actually account for this difference this way
          const actualTransactionCalldataGasUsed = await contractInteractor.calculateCalldataGasUsed(encodedData, defaultEnvironment, 1, ethersProvider)
          const calldataOverchargeGas =
            (parseInt(relayRequest.relayData.transactionCalldataGasUsed) - actualTransactionCalldataGasUsed)
          // This discrepancy should not be even close 100 gas in a transaction without paymaster, approval datas
          assert.closeTo(calldataOverchargeGas, 0, 100)
          console.log('calldataOverchargeGas', calldataOverchargeGas)
          const resultEvent = res.logs.find(e => e.event === 'TransactionResult')
          if (len === 0) {
            assert.equal(resultEvent, null, 'should not get TransactionResult with zero len')
          } else {
            assert.notEqual(resultEvent, null, 'didn\'t get TransactionResult where it should.')
          }
          const gasUsed: number = res.receipt.gasUsed
          const diff = await diffBalances(beforeBalances)
          assert.equal(diff.paymasters.toNumber(), gasUsed + calldataOverchargeGas)
        })
      })
  })

  describe('relayCall()\'s msg.data cost calculations', function () {
    enum RelayCallDynamicArg {
      APPROVAL_DATA = 'approvalData',
      ENCODED_FUNCTION = 'encodedFunction',
      PAYMASTER_DATA = 'paymasterData'
    }

    const costsPerByte: number[] = [];
    [RelayCallDynamicArg.APPROVAL_DATA, RelayCallDynamicArg.ENCODED_FUNCTION, RelayCallDynamicArg.PAYMASTER_DATA].forEach(dynamicArg => {
      const gassesUsed: any[] = [];
      [0, 32, 128, 8192/* , 32768, 65536 */].forEach(dataLength => {
        it(`with arg: ${dynamicArg} length: ${dataLength}`, async function () {
          // console.log('gasUsed: ', gassesUsed)
          const id = (await snapshot()).result
          const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
          let approvalData = '0x'
          let paymasterData = '0x'
          let encodedFunction = recipient.contract.methods.dontEmitMessage('').encodeABI()
          if (dynamicArg === RelayCallDynamicArg.APPROVAL_DATA) {
            approvalData = '0x' + 'ff'.repeat(dataLength)
          } else if (dynamicArg === RelayCallDynamicArg.ENCODED_FUNCTION) {
            encodedFunction = recipient.contract.methods.dontEmitMessage('f'.repeat(dataLength)).encodeABI()
            // console.log('encodedFunction', encodedFunction)
          } else if (dynamicArg === RelayCallDynamicArg.PAYMASTER_DATA) {
            paymasterData = '0x' + 'ff'.repeat(dataLength)
          }
          const relayRequest: RelayRequest = {
            request: {
              to: recipient.address,
              data: encodedFunction,
              from: senderAddress,
              nonce: senderNonce,
              value: '0',
              gas: gasLimit.toString(),
              validUntilTime: '0'
            },
            relayData: {
              transactionCalldataGasUsed: '0',
              maxFeePerGas: '1',
              maxPriorityFeePerGas: '1',
              relayWorker,
              forwarder,
              paymaster: paymaster.address,
              paymasterData,
              clientId
            }
          }
          const dataToSign = new TypedRequestData(
            defaultGsnConfig.domainSeparatorName,
            chainId,
            forwarder,
            relayRequest
          )
          const signature = await getEip712Signature(
            ethersProvider.getSigner(senderAddress),
            dataToSign
          )
          const relayCall = relayHub.contract.methods.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, approvalData)
          const receipt = await relayCall.send({
            from: relayWorker,
            gas: externalGasLimit,
            gasPrice: gasPrice
          })
          gassesUsed.push(receipt.gasUsed - await contractInteractor.calculateCalldataGasUsed(relayCall.encodeABI(), defaultEnvironment, 1, ethersProvider))
          // console.log('relayCall encodeABI len', relayCall.encodeABI().length / 2)
          // console.log('gasUsed is', receipt.gasUsed)
          // console.log('calculateCalldataCost is', calculateCalldataCost(relayCall.encodeABI()))
          const slack = 2
          if (gassesUsed.length > 1) {
            const diff = gassesUsed[gassesUsed.length - 1] - gassesUsed[0]
            // console.log('diff per byte is', diff / dataLength)
            // console.log('diff is', diff)
            const costPerByte = diff / dataLength
            costsPerByte.push(costPerByte)
            assert.isAtMost(costPerByte, defaultEnvironment.dataOnChainHandlingGasCostPerByte + slack, `calculated data cost per byte (${costPerByte}) higher than environment's (${defaultEnvironment.dataOnChainHandlingGasCostPerByte}) plus slack of ${slack}`)
          }
          await revert(id)
        })
      })
    })
    after('validate max gas cost per byte in relay hub', async function () {
      // console.log('costs per byte', costsPerByte)
      const maxCostPerByte = Math.max(...costsPerByte)
      assert.closeTo(defaultEnvironment.dataOnChainHandlingGasCostPerByte, maxCostPerByte, 5)
    })
  })

  describe('check calculation does not break for different fees', function () {
    [0, 1000]
      .forEach(messageLength =>
        [0, 10, 100]
          .forEach(requestedFee =>
            [0, 20].forEach(devFee => {
              // avoid duplicate coverage checks. they do the same, and take a lot of time:
              if (requestedFee !== 0 && messageLength !== 0 && process.env.MODE === 'coverage') return
              // 50k tests take more than 10 seconds to complete so will run once for sanity
              if (messageLength === 50000 && requestedFee !== 10) return
              it(
                `should compensate relay with requested fee of ${requestedFee.toString()}%, dev fee of ${devFee.toString()}% and ${messageLength.toString()} calldata size`,
                async function () {
                  let gasOverhead = toNumber(defaultEnvironment.relayHubConfiguration.gasOverhead)
                  if (devFee !== 0) {
                    gasOverhead += defaultEnvironment.nonZeroDevFeeGasOverhead
                  }
                  await prepareForHub({ gasOverhead, devAddress, pctRelayFee: requestedFee, devFee })
                  // Avoid zero to non-zero storage gas costs when calculating fees.
                  await relayHub.depositFor(relayOwner, { value: (1).toString() })

                  const beforeBalances = await getBalances()
                  const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
                  const encodedFunction = recipient.contract.methods.emitMessage('a'.repeat(messageLength)).encodeABI()
                  const baseRelayFee = '0'
                  const relayRequest: RelayRequest = {
                    request: {
                      to: recipient.address,
                      data: encodedFunction,
                      from: senderAddress,
                      nonce: senderNonce,
                      value: '0',
                      gas: gasLimit.toString(),
                      validUntilTime: '0'
                    },
                    relayData: {
                      transactionCalldataGasUsed: '0',
                      maxFeePerGas: maxFeePerGas.toString(),
                      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
                      relayWorker,
                      forwarder,
                      paymaster: paymaster.address,
                      paymasterData,
                      clientId
                    }
                  }
                  relayRequest.relayData.transactionCalldataGasUsed = await contractInteractor.estimateCalldataCostForRequest(relayRequest, {
                    maxPaymasterDataLength: 0,
                    maxApprovalDataLength: 0
                  })
                  const dataToSign = new TypedRequestData(
                    defaultGsnConfig.domainSeparatorName,
                    chainId,
                    forwarder,
                    relayRequest
                  )
                  const signature = await getEip712Signature(
                    ethersProvider.getSigner(senderAddress),
                    dataToSign
                  )
                  const res = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
                    from: relayWorker,
                    gas: externalGasLimit,
                    gasPrice: gasPrice
                  })

                  const afterBalances = await getBalances()
                  assert.notEqual(beforeBalances.relayManagers.toString(), afterBalances.relayManagers.toString(),
                    'manager not compensated. transaction must have failed')

                  // how much the relay manager got compensated for this tx from the paymaster
                  const relayerActualCharge = afterBalances.relayManagers.sub(beforeBalances.relayManagers)
                  // how much the dev address got compensated for this tx from the paymaster
                  const devActualCharge = afterBalances.devs.sub(beforeBalances.devs)
                  // how much the paymaster was charged in total
                  const actualCharge = relayerActualCharge.add(devActualCharge)

                  // how much gas we actually spent on this tx
                  const workerWeiGasUsed = beforeBalances.relayWorkers.sub(afterBalances.relayWorkers)
                  const encodedData = contractInteractor.encodeABI({
                    domainSeparatorName: defaultGsnConfig.domainSeparatorName,
                    maxAcceptanceBudget: 10e6.toString(),
                    relayRequest,
                    signature,
                    approvalData: '0x'
                  })

                  const actualTransactionCalldataGasUsed = await contractInteractor.calculateCalldataGasUsed(encodedData, defaultEnvironment, 1, ethersProvider)
                  const calldataOverchargeGas =
                    (parseInt(relayRequest.relayData.transactionCalldataGasUsed) - actualTransactionCalldataGasUsed)
                  const calldataOverchargeWei = gasPrice.muln(calldataOverchargeGas)
                  if (requestedFee === 0 && devFee === 0) {
                    logOverhead(relayerActualCharge, workerWeiGasUsed, calldataOverchargeWei)
                  }

                  // sanity: worker executed and paid this tx
                  assert.equal((gasPrice.muln(res.receipt.gasUsed)).toString(), workerWeiGasUsed.toString(), 'where else did the money go?')

                  const expectedCharge = workerWeiGasUsed.add(calldataOverchargeWei).mul(
                    toBN(requestedFee).add(toBN(100))).div(toBN(100)).add(toBN(baseRelayFee))
                  const gasDiff = actualCharge.sub(expectedCharge).div(gasPrice).mul(toBN(-1)).toString()
                  assert.equal(actualCharge.toNumber(), expectedCharge.toNumber(),
                    `actual charge from paymaster different than expected. diff = ${gasDiff}. new nonZeroDevFeeGasOverhead =
                    ${toNumber(defaultEnvironment.nonZeroDevFeeGasOverhead) + parseInt(gasDiff)}`)

                  // Validate actual profit is with high precision $(requestedFee) percent higher then ether spent relaying
                  const devExpectedCharge = expectedCharge.mul(toBN(devFee)).div(toBN(100))
                  const relayerExpectedCharge = expectedCharge.sub(devExpectedCharge)
                  assert.equal(relayerActualCharge.toNumber(), relayerExpectedCharge.toNumber(),
                    'unexpected over-paying to relayer by ' + (relayerActualCharge.sub(relayerExpectedCharge)).toString())
                  assert.equal(devActualCharge.toNumber(), devExpectedCharge.toNumber(),
                    'unexpected over-paying to dev by ' + (devActualCharge.sub(devExpectedCharge)).toString())
                  // Check that relay did pay it's gas fee by himself.
                  // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
                  const expectedBalanceAfter = beforeBalances.relayWorkers.sub(toBN(res.receipt.gasUsed).mul(toBN(gasPrice)))
                  assert.equal(expectedBalanceAfter.cmp(afterBalances.relayWorkers), 0, 'relay did not pay the expected gas fees')

                  // Check that relay's weiActualCharge is deducted from paymaster's stake.
                  const expectedPaymasterBalance = beforeBalances.paymasters.sub(actualCharge)
                  assert.equal(expectedPaymasterBalance.toString(), afterBalances.paymasters.toString())
                })
            })
          )
      )
  })
})

// @ts-ignore
contract = contractOrig
