import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import HDWalletProvider from '@truffle/hdwallet-provider'
import BN from 'bn.js'
import { ether } from '@openzeppelin/test-helpers'
import { HttpProvider, TransactionReceipt } from 'web3-core'
import { merge } from 'lodash'

import { sleep } from '../common/Utils'

// compiled folder populated by "prepublish"
import StakeManager from './compiled/StakeManager.json'
import RelayHub from './compiled/RelayHub.json'
import Penalizer from './compiled/Penalizer.json'
import Paymaster from './compiled/TestPaymasterEverythingAccepted.json'
import Forwarder from './compiled/Forwarder.json'

import { Address, notNull } from '../relayclient/types/Aliases'
import ContractInteractor from '../relayclient/ContractInteractor'
import { GSNConfig } from '../relayclient/GSNConfigurator'
import HttpClient from '../relayclient/HttpClient'
import HttpWrapper from '../relayclient/HttpWrapper'

interface RegisterOptions {
  from: Address
  stake: string | BN
  funds: string | BN
  relayUrl: string
  unstakeDelay: string
}

export interface DeploymentResult {
  relayHubAddress: Address
  stakeManagerAddress: Address
  penalizerAddress: Address
  forwarderAddress: Address
  paymasterAddress: Address
}

interface RegistrationResult {
  success: boolean
  transactions?: string[]
  error?: string
}

export default class CommandsLogic {
  private readonly contractInteractor: ContractInteractor
  private readonly httpClient: HttpClient
  private readonly config: GSNConfig
  private readonly web3: Web3

  constructor (host: string, config: GSNConfig, mnemonic?: string) {
    let provider: HttpProvider | HDWalletProvider = new Web3.providers.HttpProvider(host)
    if (mnemonic != null) {
      // web3 defines provider type quite narrowly
      provider = new HDWalletProvider(mnemonic, provider) as unknown as HttpProvider
    }
    this.contractInteractor = new ContractInteractor(provider, config)
    this.httpClient = new HttpClient(new HttpWrapper(), config)
    this.config = config
    this.web3 = new Web3(provider)
  }

  async findWealthyAccount (requiredBalance = ether('2')): Promise<string | undefined> {
    try {
      const accounts = await this.web3.eth.getAccounts()
      for (const account of accounts) {
        const balance = new BN(await this.web3.eth.getBalance(account))
        if (balance.gte(requiredBalance)) {
          return account
        }
      }
    } catch (error) {
      console.error('Failed to retrieve accounts and balances:', error)
    }
  }

  async isRelayReady (relayUrl: string): Promise<boolean> {
    const response = await this.httpClient.getPingResponse(relayUrl)
    return response.Ready
  }

  async waitForRelay (relayUrl: string): Promise<void> {
    const timeout = 30
    console.error(`Will wait up to ${timeout}s for the relay to be ready`)

    for (let i = 0; i < timeout; ++i) {
      let isReady = false
      try {
        isReady = await this.isRelayReady(relayUrl)
      } catch (e) {
        console.log(e)
      }
      if (isReady) {
        return
      }
      await sleep(1000)
    }
    throw Error(`Relay not ready after ${timeout}s`)
  }

  async getPaymasterBalance (paymaster: Address): Promise<BN> {
    const relayHub = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
    return relayHub.balanceOf(paymaster)
  }

  /**
   * Send enough ether from the {@param from} to the RelayHub to make {@param paymaster}'s gas deposit exactly {@param amount}.
   * Does nothing if current paymaster balance exceeds amount.
   * @param from
   * @param paymaster
   * @param amount
   * @return deposit of the paymaster after
   */
  async fundPaymaster (
    from: Address, paymaster: Address, amount: string | BN
  ): Promise<BN> {
    const relayHub = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
    const targetAmount = new BN(amount)
    const currentBalance = await relayHub.balanceOf(paymaster)
    if (currentBalance.lt(targetAmount)) {
      const value = targetAmount.sub(currentBalance)
      await relayHub.depositFor(paymaster, {
        value,
        from
      })
      return targetAmount
    } else {
      return currentBalance
    }
  }

  async registerRelay (options: RegisterOptions): Promise<RegistrationResult> {
    try {
      if (await this.isRelayReady(options.relayUrl)) {
        return {
          success: false,
          error: 'Already registered'
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `Could not reach the relay at ${options.relayUrl}, is it running?`
      }
    }

    let stakeTx: Truffle.TransactionResponse | undefined
    let authorizeTx: Truffle.TransactionResponse | undefined
    let fundTx: TransactionReceipt | undefined
    try {
      console.error(`Funding GSN relay at ${options.relayUrl}`)

      const response = await this.httpClient.getPingResponse(options.relayUrl)
      const relayAddress = response.RelayManagerAddress
      const relayHub = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
      const stakeManagerAddress = await relayHub.getStakeManager()
      const stakeManager = await this.contractInteractor._createStakeManager(stakeManagerAddress)
      stakeTx = await stakeManager
        .stakeForAddress(relayAddress, options.unstakeDelay.toString(), {
          value: options.stake,
          from: options.from,
          gas: 1e6,
          gasPrice: 1e9
        })
      authorizeTx = await stakeManager
        .authorizeHub(relayAddress, this.config.relayHubAddress, {
          from: options.from,
          gas: 1e6,
          gasPrice: 1e9
        })
      const _fundTx = await this.web3.eth.sendTransaction({
        from: options.from,
        to: relayAddress,
        value: options.funds,
        gas: 1e6,
        gasPrice: 1e9
      })

      fundTx = _fundTx as TransactionReceipt
      if (fundTx.transactionHash == null) {
        return {
          success: false,
          error: `Fund transaction reverted: ${_fundTx.toString()}`
        }
      }
      await this.waitForRelay(options.relayUrl)
      return {
        success: true,
        transactions: [stakeTx.tx, authorizeTx.tx, fundTx.transactionHash]
      }
    } catch (error) {
      return {
        success: false,
        transactions: [stakeTx?.tx, authorizeTx?.tx, fundTx?.transactionHash].filter(notNull),
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        error: `Failed to fund relay: '${error}'`
      }
    }
  }

  contract (file: any): Contract {
    return new this.web3.eth.Contract(file.abi, undefined, { data: file.bytecode })
  }

  async deployGsnContracts (from: Address, gasPrice?: string, paymaster?: any): Promise<DeploymentResult> {
    const options = {
      from,
      gas: 3e6,
      gasPrice: gasPrice ?? (1e9).toString()
    }

    const sInstance =
      await this.contract(StakeManager).deploy({}).send(options)
    const pInstance =
      await this.contract(Penalizer).deploy({}).send(options)
    const pmInstance =
      await this.contract(paymaster ?? Paymaster).deploy({}).send(options)
    const fInstance =
      await this.contract(Forwarder).deploy({}).send(merge(options, { gas: 5e6 }))
    const rInstance = await this.contract(RelayHub).deploy({
      arguments: [sInstance.options.address, pInstance.options.address]
    }).send(merge(options, { gas: 5e6 }))

    await rInstance.methods.registerRequestType(fInstance.options.address).send(options)

    await pmInstance.methods.setRelayHub(rInstance.options.address).send({
      from,
      gas: 1e6,
      gasPrice: 1e9
    })

    // Overriding saved configuration with newly deployed instances
    this.config.paymasterAddress = pmInstance.options.address
    this.config.stakeManagerAddress = sInstance.options.address
    this.config.relayHubAddress = rInstance.options.address

    return {
      relayHubAddress: rInstance.options.address,
      stakeManagerAddress: sInstance.options.address,
      penalizerAddress: pInstance.options.address,
      forwarderAddress: fInstance.options.address,
      paymasterAddress: pmInstance.options.address
    }
  }
}
