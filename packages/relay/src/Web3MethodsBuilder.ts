import BN from 'bn.js'
import Web3 from 'web3'

import {
  Address,
  GSNContractsDeployment,
  IntString,
  RelayRequest,
  splitRelayUrlForRegistrar,
  toBN
} from '@opengsn/common'

import penalizerAbi from '@opengsn/common/dist/interfaces/IPenalizer.json'
import relayHubAbi from '@opengsn/common/dist/interfaces/IRelayHub.json'
import relayRegistrarAbi from '@opengsn/common/dist/interfaces/IRelayRegistrar.json'
import stakeManagerAbi from '@opengsn/common/dist/interfaces/IStakeManager.json'

export class Web3MethodsBuilder {
  private readonly IPenalizer: any
  private readonly IRelayHubContract: any
  private readonly IRelayRegistrar: any
  private readonly IStakeManager: any

  constructor (web3: Web3, deployment?: GSNContractsDeployment) {
    // @ts-ignore
    this.IStakeManager = new web3.eth.Contract(stakeManagerAbi, deployment?.stakeManagerAddress)
    // @ts-ignore
    this.IRelayRegistrar = new web3.eth.Contract(relayRegistrarAbi, deployment?.relayRegistrarAddress)
    // @ts-ignore
    this.IRelayHubContract = new web3.eth.Contract(relayHubAbi, deployment?.relayHubAddress)
    // @ts-ignore
    this.IPenalizer = new web3.eth.Contract(penalizerAbi, deployment?.penalizerAddress)
  }

  // TODO: a way to make a relay hub transaction with a specified nonce without exposing the 'method' abstraction
  async getRegisterRelayMethod (relayHub: Address, url: string): Promise<any> {
    return this.IRelayRegistrar.methods.registerRelayServer(relayHub, splitRelayUrlForRegistrar(url))
  }

  async getAuthorizeHubByManagerMethod (relayHub: Address): Promise<any> {
    return this.IStakeManager.methods.authorizeHubByManager(relayHub)
  }

  async getAddRelayWorkersMethod (workers: Address[]): Promise<any> {
    return this.IRelayHubContract.methods.addRelayWorkers(workers)
  }

  async getSetRelayManagerMethod (owner: Address): Promise<any> {
    return this.IStakeManager.methods.setRelayManagerOwner(owner)
  }

  async getWithdrawMethod (destination: Address, amount: BN): Promise<any> {
    return this.IRelayHubContract.methods.withdraw(destination, amount.toString())
  }

  async withdrawHubBalanceEstimateGas (destination: Address, amount: BN, managerAddress: Address, gasPrice: IntString): Promise<{
    gasCost: BN
    gasLimit: number
    method: any
  }> {
    const method = await this.getWithdrawMethod(destination, amount)
    const withdrawTxGasLimit = await method.estimateGas(
      {
        from: managerAddress
      })
    const gasCost = toBN(withdrawTxGasLimit).mul(toBN(gasPrice))
    return {
      gasLimit: parseInt(withdrawTxGasLimit),
      gasCost,
      method
    }
  }

  getRelayCallMethod (
    domainSeparatorName: string,
    maxAcceptanceBudget: number | string,
    relayRequest: RelayRequest,
    signature: string,
    approvalData: string
  ): any {
    return this.IRelayHubContract.methods.relayCall(
      domainSeparatorName,
      maxAcceptanceBudget,
      relayRequest,
      signature,
      approvalData)
  }

  getPenalizerCommitMethod (commitHash: string): any {
    return this.IPenalizer.methods.commit(commitHash)
  }

  getPenalizeRepeatedNonceMethod (...args: any[]): any {
    return this.IPenalizer.methods.penalizeRepeatedNonce(...args)
  }

  getPenalizeIllegalTransactionMethod (...args: any[]): any {
    return this.IPenalizer.methods.penalizeIllegalTransaction(...args)
  }
}
