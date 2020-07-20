import Web3 from 'web3'
import { Contract, SendOptions } from 'web3-eth-contract'
import HDWalletProvider from '@truffle/hdwallet-provider'
import BN from 'bn.js'
import { HttpProvider, TransactionReceipt } from 'web3-core'
import { merge } from 'lodash'

import { ether, sleep } from '../common/Utils'

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
import { GsnRequestType } from '../common/EIP712/TypedRequestData'
import { constants } from '../common/Constants'
import { RelayHubConfiguration } from '../relayclient/types/RelayHubConfiguration'

interface RegisterOptions {
  from: Address
  stake: string | BN
  funds: string | BN
  relayUrl: string
  unstakeDelay: string
}

interface DeployOptions {
  from: Address
  gasPrice?: string
  gasLimit?: number
  deployPaymaster?: boolean
  forwarderAddress?: string
  relayHubConfiguration: RelayHubConfiguration
}

export interface DeploymentResult {
  relayHubAddress: Address
  stakeManagerAddress: Address
  penalizerAddress: Address
  forwarderAddress: Address
  naivePaymasterAddress: Address
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
    return await relayHub.balanceOf(paymaster)
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
      const stakeManagerAddress = await relayHub.stakeManager()
      const stakeManager = await this.contractInteractor._createStakeManager(stakeManagerAddress)
      stakeTx = await stakeManager
        .stakeForAddress(relayAddress, options.unstakeDelay.toString(), {
          value: options.stake,
          from: options.from,
          gas: 1e6,
          gasPrice: 1e9
        })
      authorizeTx = await stakeManager
        .authorizeHubByOwner(relayAddress, this.config.relayHubAddress, {
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
          error: `Fund transaction reverted: ${JSON.stringify(_fundTx)}`
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

  contract (file: any, address?: string): Contract {
    return new this.web3.eth.Contract(file.abi, address, { data: file.bytecode })
  }

  async deployGsnContracts (deployOptions: DeployOptions): Promise<DeploymentResult> {
    const options: SendOptions = {
      from: deployOptions.from,
      gas: deployOptions.gasLimit ?? 3e6,
      gasPrice: deployOptions.gasPrice ?? (1e9).toString()
    }

    const sInstance =
      await this.contract(StakeManager).deploy({}).send(options)
    const pInstance =
      await this.contract(Penalizer).deploy({}).send(options)
    let fInstance
    if (deployOptions.forwarderAddress == null) {
      fInstance = await this.contract(Forwarder).deploy({}).send(merge(options, { gas: 5e6 }))
    } else {
      fInstance = this.contract(Forwarder, deployOptions.forwarderAddress)
    }
    const rInstance = await this.contract(RelayHub).deploy({
      arguments: [
        sInstance.options.address,
        pInstance.options.address,
        deployOptions.relayHubConfiguration.maxWorkerCount,
        deployOptions.relayHubConfiguration.gasReserve,
        deployOptions.relayHubConfiguration.postOverhead,
        deployOptions.relayHubConfiguration.gasOverhead,
        deployOptions.relayHubConfiguration.maximumRecipientDeposit,
        deployOptions.relayHubConfiguration.minimumUnstakeDelay,
        deployOptions.relayHubConfiguration.minimumStake]
    }).send(merge(options, { gas: 5e6 }))

    let paymasterAddress = constants.ZERO_ADDRESS
    if (deployOptions.deployPaymaster === true) {
      const pmInstance = await this.deployPaymaster(options, rInstance.options.address, deployOptions.from, fInstance)
      paymasterAddress = pmInstance.options.address

      // Overriding saved configuration with newly deployed instances
      this.config.paymasterAddress = paymasterAddress
    }
    this.config.stakeManagerAddress = sInstance.options.address
    this.config.relayHubAddress = rInstance.options.address

    await fInstance.methods.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    ).send(options)

    return {
      relayHubAddress: rInstance.options.address,
      stakeManagerAddress: sInstance.options.address,
      penalizerAddress: pInstance.options.address,
      forwarderAddress: fInstance.options.address,
      naivePaymasterAddress: paymasterAddress
    }
  }

  async deployPaymaster (options: SendOptions, hub: Address, from: string, fInstance: Contract): Promise<Contract> {
    const pmInstance = await this.contract(Paymaster).deploy({}).send(options)
    await pmInstance.methods.setRelayHub(hub).send(options)
    await pmInstance.methods.setTrustedForwarder(fInstance.options.address).send(options)
    return pmInstance
  }
}
