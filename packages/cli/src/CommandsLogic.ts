// @ts-ignore
import io from 'console-read-write'
import BN from 'bn.js'
import HDWalletProvider from '@truffle/hdwallet-provider'
import Web3 from 'web3'
import { Contract, SendOptions } from 'web3-eth-contract'
import { HttpProvider, TransactionReceipt } from 'web3-core'
import { fromWei, toBN } from 'web3-utils'
import ow from 'ow'

import { ether, isSameAddress, sleep } from '@opengsn/common/dist/Utils'

// compiled folder populated by "prepublish"
import StakeManager from './compiled/StakeManager.json'
import RelayHub from './compiled/RelayHub.json'
import Penalizer from './compiled/Penalizer.json'
import Paymaster from './compiled/TestPaymasterEverythingAccepted.json'
import Forwarder from './compiled/Forwarder.json'
import VersionRegistryAbi from './compiled/VersionRegistry.json'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { constants } from '@opengsn/common/dist/Constants'
import { RelayHubConfiguration } from '@opengsn/common/dist/types/RelayHubConfiguration'
import { string32 } from '@opengsn/common/dist/VersionRegistry'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { HttpWrapper } from '@opengsn/common/dist/HttpWrapper'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { PenalizerConfiguration } from '@opengsn/common/dist/types/PenalizerConfiguration'

export interface RegisterOptions {
  /** ms to sleep if waiting for RelayServer to set its owner */
  sleepMs: number
  /** number of times to sleep before timeout */
  sleepCount: number
  from: Address
  gasPrice: string | BN
  stake: string | BN
  funds: string | BN
  relayUrl: string
  unstakeDelay: string
}

interface DeployOptions {
  from: Address
  gasPrice: string
  gasLimit: number
  deployPaymaster?: boolean
  forwarderAddress?: string
  relayHubAddress?: string
  stakeManagerAddress?: string
  penalizerAddress?: string
  registryAddress?: string
  registryHubId?: string
  verbose?: boolean
  skipConfirmation?: boolean
  relayHubConfiguration: RelayHubConfiguration
  penalizerConfiguration: PenalizerConfiguration
}

/**
 * Must verify these parameters are passed to deploy script
 */
const DeployOptionsPartialShape = {
  from: ow.string,
  gasPrice: ow.string,
  gasLimit: ow.number
}

interface RegistrationResult {
  success: boolean
  transactions?: string[]
  error?: string
}

export class CommandsLogic {
  private readonly contractInteractor: ContractInteractor
  private readonly httpClient: HttpClient
  private readonly web3: Web3

  private deployment?: GSNContractsDeployment

  constructor (
    host: string,
    logger: LoggerInterface,
    deployment: GSNContractsDeployment,
    mnemonic?: string
  ) {
    let provider: HttpProvider | HDWalletProvider = new Web3.providers.HttpProvider(host, {
      keepAlive: true,
      timeout: 120000
    })
    if (mnemonic != null) {
      // web3 defines provider type quite narrowly
      provider = new HDWalletProvider(mnemonic, provider) as unknown as HttpProvider
    }
    this.httpClient = new HttpClient(new HttpWrapper(), logger)
    const maxPageSize = Number.MAX_SAFE_INTEGER
    this.contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize })
    this.deployment = deployment
    this.web3 = new Web3(provider)
  }

  async init (): Promise<this> {
    await this.contractInteractor.init()
    return this
  }

  async findWealthyAccount (requiredBalance = ether('2')): Promise<string> {
    let accounts: string[] = []
    try {
      accounts = await this.web3.eth.getAccounts()
      for (const account of accounts) {
        const balance = new BN(await this.web3.eth.getBalance(account))
        if (balance.gte(requiredBalance)) {
          console.log(`Found funded account ${account}`)
          return account
        }
      }
    } catch (error) {
      console.error('Failed to retrieve accounts and balances:', error)
    }
    throw new Error(`could not find unlocked account with sufficient balance; all accounts:\n - ${accounts.join('\n - ')}`)
  }

  async isRelayReady (relayUrl: string): Promise<boolean> {
    const response = await this.httpClient.getPingResponse(relayUrl)
    return response.ready
  }

  async waitForRelay (relayUrl: string, timeout = 60): Promise<void> {
    console.error(`Will wait up to ${timeout}s for the relay to be ready`)

    const endTime = Date.now() + timeout * 1000
    while (Date.now() < endTime) {
      let isReady = false
      try {
        isReady = await this.isRelayReady(relayUrl)
      } catch (e) {
        console.log(e.message)
      }
      if (isReady) {
        return
      }
      await sleep(3000)
    }
    throw Error(`Relay not ready after ${timeout}s`)
  }

  async getPaymasterBalance (paymaster: Address): Promise<BN> {
    if (this.deployment == null) {
      throw new Error('Deployment is not initialized!')
    }
    return await this.contractInteractor.hubBalanceOf(paymaster)
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
    if (this.deployment == null) {
      throw new Error('Deployment is not initialized!')
    }
    const currentBalance = await this.contractInteractor.hubBalanceOf(paymaster)
    const targetAmount = new BN(amount)
    if (currentBalance.lt(targetAmount)) {
      const value = targetAmount.sub(currentBalance)
      await this.contractInteractor.hubDepositFor(paymaster, {
        value,
        from
      })
      return targetAmount
    } else {
      return currentBalance
    }
  }

  async registerRelay (options: RegisterOptions): Promise<RegistrationResult> {
    const transactions: string[] = []
    try {
      console.log(`Registering GSN relayer at ${options.relayUrl}`)

      const response = await this.httpClient.getPingResponse(options.relayUrl)
        .catch((error: any) => {
          console.error(error)
          throw new Error('could contact not relayer, is it running?')
        })
      if (response.ready) {
        return {
          success: false,
          error: 'Nothing to do. Relayer already registered'
        }
      }
      const chainId = this.contractInteractor.chainId
      if (response.chainId !== chainId.toString()) {
        throw new Error(`wrong chain-id: Relayer on (${response.chainId}) but our provider is on (${chainId})`)
      }
      const relayAddress = response.relayManagerAddress
      const relayHubAddress = response.relayHubAddress

      const relayHub = await this.contractInteractor._createRelayHub(relayHubAddress)
      const stakeManagerAddress = await relayHub.stakeManager()
      const stakeManager = await this.contractInteractor._createStakeManager(stakeManagerAddress)
      const { stake, unstakeDelay, owner } = await stakeManager.getStakeInfo(relayAddress)

      console.log('current stake=', fromWei(stake, 'ether'))

      if (owner !== constants.ZERO_ADDRESS && !isSameAddress(owner, options.from)) {
        throw new Error(`Already owned by ${owner}, our account=${options.from}`)
      }

      const bal = await this.contractInteractor.getBalance(relayAddress)
      if (toBN(bal).gt(toBN(options.funds.toString()))) {
        console.log('Relayer already funded')
      } else {
        console.log('Funding relayer')

        const _fundTx = await this.web3.eth.sendTransaction({
          from: options.from,
          to: relayAddress,
          value: options.funds,
          gas: 1e6,
          gasPrice: options.gasPrice
        })
        const fundTx = _fundTx as TransactionReceipt
        if (fundTx.transactionHash == null) {
          return {
            success: false,
            error: `Fund transaction reverted: ${JSON.stringify(_fundTx)}`
          }
        }
        transactions.push(fundTx.transactionHash)
      }

      if (owner === constants.ZERO_ADDRESS) {
        let i = 0
        while (true) {
          console.debug(`Waiting ${options.sleepMs}ms ${i}/${options.sleepCount} for relayer to set ${options.from} as owner`)
          await sleep(options.sleepMs)
          const newStakeInfo = await stakeManager.getStakeInfo(relayAddress)
          if (newStakeInfo.owner !== constants.ZERO_ADDRESS && isSameAddress(newStakeInfo.owner, options.from)) {
            console.log('RelayServer successfully set its owner on the StakeManager')
            break
          }
          if (options.sleepCount === i++) {
            throw new Error('RelayServer failed to set its owner on the StakeManager')
          }
        }
      }
      if (unstakeDelay.gte(toBN(options.unstakeDelay)) &&
        stake.gte(toBN(options.stake.toString()))
      ) {
        console.log('Relayer already staked')
      } else {
        const config = await relayHub.getConfiguration()
        if (config.minimumStake.gt(toBN(options.stake.toString()))) {
          throw new Error(`Given minimum stake ${options.stake.toString()} too low for the given hub ${config.minimumStake.toString()}`)
        }
        if (config.minimumUnstakeDelay.gt(toBN(options.unstakeDelay))) {
          throw new Error(`Given minimum unstake delay ${options.unstakeDelay.toString()} too low for the given hub ${config.minimumUnstakeDelay.toString()}`)
        }
        const stakeValue = toBN(options.stake.toString()).sub(stake)
        console.log(`Staking relayer ${fromWei(stakeValue, 'ether')} eth`,
          stake.toString() === '0' ? '' : ` (already has ${fromWei(stake, 'ether')} eth)`)

        const stakeTx = await stakeManager
          .stakeForRelayManager(relayAddress, options.unstakeDelay.toString(), {
            value: stakeValue,
            from: options.from,
            gas: 1e6,
            gasPrice: options.gasPrice
          })
        // @ts-ignore
        transactions.push(stakeTx.transactionHash)
      }

      if (await stakeManager.isRelayManagerStaked(relayAddress, relayHubAddress, 0, 0)) {
        console.log('Relayer already authorized')
      } else {
        console.log('Authorizing relayer for hub')
        const authorizeTx = await stakeManager
          .authorizeHubByOwner(relayAddress, relayHubAddress, {
            from: options.from,
            gas: 1e6,
            gasPrice: options.gasPrice
          })
        // @ts-ignore
        transactions.push(authorizeTx.transactionHash)
      }

      await this.waitForRelay(options.relayUrl)
      return {
        success: true,
        transactions
      }
    } catch (error) {
      return {
        success: false,
        transactions,
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        error: error.message
      }
    }
  }

  contract (file: any, address?: string): Contract {
    return new this.web3.eth.Contract(file.abi, address, { data: file.bytecode })
  }

  async deployGsnContracts (deployOptions: DeployOptions): Promise<GSNContractsDeployment> {
    ow(deployOptions, ow.object.partialShape(DeployOptionsPartialShape))
    const options: Required<SendOptions> = {
      from: deployOptions.from,
      gas: deployOptions.gasLimit,
      value: 0,
      gasPrice: deployOptions.gasPrice
    }
    const sInstance = await this.getContractInstance(StakeManager, {
      arguments: [defaultEnvironment.maxUnstakeDelay]
    }, deployOptions.stakeManagerAddress, { ...options }, deployOptions.skipConfirmation)
    const pInstance = await this.getContractInstance(Penalizer, {
      arguments: [
        deployOptions.penalizerConfiguration.penalizeBlockDelay,
        deployOptions.penalizerConfiguration.penalizeBlockExpiration
      ]
    }, deployOptions.penalizerAddress, { ...options }, deployOptions.skipConfirmation)
    const fInstance = await this.getContractInstance(Forwarder, {}, deployOptions.forwarderAddress, { ...options }, deployOptions.skipConfirmation)
    const rInstance = await this.getContractInstance(RelayHub, {
      arguments: [
        sInstance.options.address,
        pInstance.options.address,
        deployOptions.relayHubConfiguration.maxWorkerCount,
        deployOptions.relayHubConfiguration.gasReserve,
        deployOptions.relayHubConfiguration.postOverhead,
        deployOptions.relayHubConfiguration.gasOverhead,
        deployOptions.relayHubConfiguration.maximumRecipientDeposit,
        deployOptions.relayHubConfiguration.minimumUnstakeDelay,
        deployOptions.relayHubConfiguration.minimumStake,
        deployOptions.relayHubConfiguration.dataGasCostPerByte,
        deployOptions.relayHubConfiguration.externalCallDataCostOverhead]
    }, deployOptions.relayHubAddress, { ...options }, deployOptions.skipConfirmation)

    const regInstance = await this.getContractInstance(VersionRegistryAbi, {}, deployOptions.registryAddress, { ...options }, deployOptions.skipConfirmation)
    if (deployOptions.registryHubId != null) {
      await regInstance.methods.addVersion(string32(deployOptions.registryHubId), string32('1'), rInstance.options.address).send({ ...options })
      console.log(`== Saved RelayHub address at HubId:"${deployOptions.registryHubId}" to VersionRegistry`)
    }

    let pmInstance: Contract | undefined
    if (deployOptions.deployPaymaster ?? false) {
      pmInstance = await this.deployPaymaster({ ...options }, rInstance.options.address, deployOptions.from, fInstance, deployOptions.skipConfirmation)
    }
    await registerForwarderForGsn(fInstance, options)

    this.deployment = {
      relayHubAddress: rInstance.options.address,
      stakeManagerAddress: sInstance.options.address,
      penalizerAddress: pInstance.options.address,
      forwarderAddress: fInstance.options.address,
      versionRegistryAddress: regInstance.options.address,
      paymasterAddress: pmInstance?.options.address ?? constants.ZERO_ADDRESS
    }

    await this.contractInteractor.initDeployment(this.deployment)
    return this.deployment
  }

  private async getContractInstance (json: any, constructorArgs: any, address: Address | undefined, options: Required<SendOptions>, skipConfirmation: boolean = false): Promise<Contract> {
    const contractName: string = json.contractName
    let contractInstance
    if (address == null) {
      const sendMethod = this
        .contract(json)
        .deploy(constructorArgs)
      const estimatedGasCost = await sendMethod.estimateGas({ ...options })
      const maxCost = new BN(options.gasPrice).muln(options.gas)
      console.log(`Deploying ${contractName} contract with gas limit of ${options.gas.toLocaleString()} at ${fromWei(options.gasPrice, 'gwei')}gwei (estimated gas: ${estimatedGasCost.toLocaleString()}) and maximum cost of ~ ${fromWei(maxCost)} ETH`)
      if (!skipConfirmation) {
        await this.confirm()
      }
      const deployPromise = sendMethod.send({ ...options })
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deployPromise.on('transactionHash', function (hash) {
        console.log(`Transaction broadcast: ${hash}`)
      })
      contractInstance = await deployPromise
      console.log(`Deployed ${contractName} at address ${contractInstance.options.address}\n\n`)
    } else {
      console.log(`Using ${contractName} at given address ${address}\n\n`)
      contractInstance = this.contract(json, address)
    }
    return contractInstance
  }

  async deployPaymaster (options: Required<SendOptions>, hub: Address, from: string, fInstance: Contract, skipConfirmation: boolean | undefined): Promise<Contract> {
    const pmInstance = await this.getContractInstance(Paymaster, {}, undefined, { ...options }, skipConfirmation)
    await pmInstance.methods.setRelayHub(hub).send(options)
    await pmInstance.methods.setTrustedForwarder(fInstance.options.address).send(options)
    return pmInstance
  }

  async confirm (): Promise<void> {
    let input
    while (true) {
      console.log('Confirm (yes/no)?')
      input = await io.read()
      if (input === 'yes') {
        return
      } else if (input === 'no') {
        throw new Error('User rejected')
      }
    }
  }
}
