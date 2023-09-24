import { BigNumber } from '@ethersproject/bignumber'
import { type IPaymaster } from '@opengsn/contracts/types/ethers-contracts'

import { type Address, type IntString } from './types/Aliases'
import { type ContractInteractor, type RelayCallABI } from './ContractInteractor'
import { type LoggerInterface } from './LoggerInterface'
import { type RelayTransactionRequest } from './types/RelayTransactionRequest'
import { constants } from './Constants'
import { toBN } from './web3js/Web3JSUtils'
import { toNumber, bigNumberMin } from './Utils'

/**
 * After EIP-150, every time the call stack depth is increased without explicit call gas limit set,
 * the 63/64th rule is applied to gas limit.
 * As we have to pass enough gas to a transaction to pass 'relayRequest.request.gas' to the recipient,
 * and this check is at stack depth of 3, we have to oversupply gas to an outermost ('relayCall') transaction
 * by approximately 1/(63/64)^3 times.
 */
const GAS_FACTOR = 1.1

/**
 * A constant oversupply of gas to each 'relayCall' transaction.
 */
const GAS_RESERVE = 100000

export interface RelayRequestLimits {
  effectiveAcceptanceBudgetGasUsed: number
  maxPossibleGasUsed: BigNumber
  maxPossibleCharge: BigNumber
  transactionCalldataGasUsed: number
}

/**
 * TODO: client - use same value for DRY and VIEW calls!
 * This class ensures both client and server use the same logic to calculate 'gas limit' parameter for the 'relayCall()'
 * However, for the client-side calculation actual signature and approval data are not known during the DRY-RUN and
 * must be filled with non-zero bytes.
 * For the server-side calculation the Paymaster's acceptance budget can be overridden. TODO: THIS IS NOT GAS LIMIT RELATED.
 */
export class RelayCallGasLimitCalculationHelper {
  constructor (
    readonly logger: LoggerInterface,
    readonly contractInteractor: ContractInteractor,
    readonly calldataEstimationSlackFactor: number,
    readonly relayHubCalculateChargeViewCallGasLimit: IntString | number
  ) {}

  /** ***** */

  /**
   * Accepts the full RelayRequest object and calculates the effective gas limits for the transaction.
   */
  async calculateRelayRequestLimits (
    relayTransactionRequest: RelayTransactionRequest,
    gasAndDataLimits: IPaymaster.GasAndDataLimitsStructOutput
  ): Promise<RelayRequestLimits> {
    const relayCallAbiInput: RelayCallABI = {
      domainSeparatorName: relayTransactionRequest.metadata.domainSeparatorName,
      maxAcceptanceBudget: '0xffffffff',
      relayRequest: relayTransactionRequest.relayRequest,
      signature: relayTransactionRequest.metadata.signature,
      approvalData: relayTransactionRequest.metadata.approvalData
    }
    const msgData = this.contractInteractor.encodeABI(relayCallAbiInput)

    const transactionCalldataGasUsed = await this.contractInteractor.calculateCalldataGasUsed(
      msgData, this.contractInteractor.environment, this.calldataEstimationSlackFactor, this.contractInteractor.provider)

    const innerRecipientCallGasLimit = relayTransactionRequest.relayRequest.request.gas
    const maxPossibleGasUsed = this.calculateTransactionMaxPossibleGasUsed(
      msgData.length, gasAndDataLimits, innerRecipientCallGasLimit, transactionCalldataGasUsed)

    const effectiveAcceptanceBudgetGasUsed = gasAndDataLimits.acceptanceBudget.toNumber() + transactionCalldataGasUsed

    const maxPossibleGasUsedFactorReserve = GAS_RESERVE + Math.floor(maxPossibleGasUsed.toNumber() * GAS_FACTOR)

    // note: we must set 'from', 'gasLimit' and 'gasPrice' parameters as well to avoid failing a
    // view call with 'insufficient gas' as the sender balance is checked to have sufficient balance
    const txDetails = {
      from: constants.DRY_RUN_ADDRESS,
      gasLimit: this.relayHubCalculateChargeViewCallGasLimit,
      gasPrice: relayTransactionRequest.relayRequest.relayData.maxFeePerGas
    }
    const maxPossibleCharge = await this.contractInteractor.calculateChargeWithRelayHub(
      maxPossibleGasUsedFactorReserve,
      relayTransactionRequest.relayRequest.relayData,
      txDetails
    )

    return {
      effectiveAcceptanceBudgetGasUsed,
      transactionCalldataGasUsed,
      maxPossibleCharge: BigNumber.from(maxPossibleCharge.toString()),
      maxPossibleGasUsed: BigNumber.from(maxPossibleGasUsedFactorReserve)
    }
  }

  /**
   * @returns result - maximum possible gas consumption by this relayed call.
   *          This value should match a value calculated on chain by RelayHub.verifyGasAndDataLimits
   */
  calculateTransactionMaxPossibleGasUsed (
    // TODO: maybe I need a function to return 'msgDataLength', 'calldataGasUsed'?
    msgDataLength: number,
    gasAndDataLimits: IPaymaster.GasAndDataLimitsStructOutput,
    innerRecipientCallGasLimit: string,
    calldataGasUsed: number
  ): BigNumber {
    const msgDataGasCostInsideTransaction: number =
      toBN(this.contractInteractor.environment.dataOnChainHandlingGasCostPerByte)
        .muln(msgDataLength)
        .toNumber()

    const gasOverhead = this.contractInteractor.relayHubConfiguration.gasOverhead
    const result = toNumber(gasOverhead.toString()) +
      msgDataGasCostInsideTransaction +
      calldataGasUsed +
      parseInt(innerRecipientCallGasLimit) +
      toNumber(gasAndDataLimits.preRelayedCallGasLimit.toString()) +
      toNumber(gasAndDataLimits.postRelayedCallGasLimit.toString())

    this.logger.debug(`
msgDataLength: ${msgDataLength}
calldataGasUsed: ${calldataGasUsed}
gasAndDataLimits: ${gasAndDataLimits.preRelayedCallGasLimit.toString()} + ${gasAndDataLimits.postRelayedCallGasLimit.toString()} 
innerRecipientCallGasLimit: ${innerRecipientCallGasLimit}
msgDataGasCostInsideTransaction: ${msgDataGasCostInsideTransaction}
dataOnChainHandlingGasCostPerByte: ${this.contractInteractor.environment.dataOnChainHandlingGasCostPerByte}
relayHubGasOverhead: ${gasOverhead.toString()}
calculateTransactionMaxPossibleGas: result: ${result}
`)
    return BigNumber.from(result)
  }

  /**
   * Called only by the client to check if the desired amount is available to the paymaster.
   * Does not take into account any balance requirements that the Paymaster may have in 'preRelayedCall'
   */
  async adjustRelayCallViewGasLimitForRelay (
    viewCallGasLimit: BigNumber,
    workerAddress: Address,
    maxFeePerGas: BigNumber
  ): Promise<BigNumber> {
    const workerBalanceStr = await this.contractInteractor.getBalance(workerAddress, 'pending')

    const workerBalanceGasLimit = this.balanceToGas(BigNumber.from(workerBalanceStr), maxFeePerGas)

    if (workerBalanceGasLimit.lt(viewCallGasLimit)) {
      const warning =
        `Relay Worker balance: ${workerBalanceStr.toString()}\n` +
        `This is only enough for ${workerBalanceGasLimit.toString()} gas for a view call at ${maxFeePerGas.toString()} per gas.\n` +
        'Limiting the view call gas limit but successful relaying is not likely.'
      this.logger.warn(warning)
      return workerBalanceGasLimit
    }
    return viewCallGasLimit
  }

  balanceToGas (
    balance: BigNumber,
    maxFeePerGas: BigNumber
  ): BigNumber {
    const pctRelayFeeDev = BigNumber.from(this.contractInteractor.relayHubConfiguration.pctRelayFee.toString()).add(100)
    return balance.div(maxFeePerGas)
      .mul(100)
      .div(pctRelayFeeDev)
      .mul(3).div(4) // hard-coded to use 75% of available balance
  }

  async adjustRelayCallViewGasLimitForPaymaster (
    maxPossibleGasUsed: BigNumber,
    paymasterAddress: Address,
    maxFeePerGas: BigNumber,
    maxViewableGasLimit: BigNumber,
    minViewableGasLimit: BigNumber
  ): Promise<BigNumber> {
    // 1. adjust to minimum and maximum viewable gas limits
    if (maxPossibleGasUsed.gt(maxViewableGasLimit)) {
      this.logger.warn(`Adjusting view call gas limit: using maximum ${maxViewableGasLimit.toString()} instead of estimation ${maxPossibleGasUsed.toString()}`)
      return maxViewableGasLimit
    }
    if (maxPossibleGasUsed.lt(minViewableGasLimit)) {
      this.logger.warn(`Adjusting view call gas limit: using minimum ${minViewableGasLimit.toString()} instead of estimation ${maxPossibleGasUsed.toString()}`)
      return minViewableGasLimit
    }

    // 2. check paymaster balance
    const paymasterBalance = await this.contractInteractor.hubBalanceOf(paymasterAddress)
    const paymasterBalanceGasLimit = this.balanceToGas(paymasterBalance, maxFeePerGas)

    const blockGasLimitNum = await this.contractInteractor.getBlockGasLimit()
    const blockGasLimit = BigNumber.from(blockGasLimitNum)
      .mul(3).div(4) // hard-coded to use 75% of available block gas limit

    const minimalLimit = bigNumberMin(paymasterBalanceGasLimit, blockGasLimit)

    if (minimalLimit.lt(maxPossibleGasUsed)) {
      const warning =
        `Block gas limit: ${blockGasLimit.toString()}\n` +
        `Paymaster balance: ${paymasterBalance.toString()}\n` +
        `This is only enough for ${minimalLimit.toString()} gas for a view call at ${maxFeePerGas.toString()} per gas.\n` +
        'Limiting the view call gas limit but successful relaying is not likely.'
      this.logger.warn(warning)
      return minimalLimit
    }

    // 3. No need to adjust - use the estimated "maxPossibleGasUsed"
    return maxPossibleGasUsed
  }
}
