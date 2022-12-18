// @ts-ignore
import io from 'console-read-write'
import BN from 'bn.js'
import HDWalletProvider from '@truffle/hdwallet-provider'
import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import { fromWei, toBN, toHex } from 'web3-utils'
import ow from 'ow'

import {
  Address,
  ContractInteractor,
  GSNContractsDeployment,
  HttpClient,
  HttpWrapper,
  IntString,
  LoggerInterface,
  PenalizerConfiguration,
  RelayHubConfiguration,
  constants,
  defaultEnvironment,
  ether,
  formatTokenAmount,
  isSameAddress,
  registerForwarderForGsn,
  sleep,
  toNumber
} from '@opengsn/common'

// compiled folder populated by "preprocess"
import StakeManager from './compiled/StakeManager.json'
import RelayHub from './compiled/RelayHub.json'
import RelayRegistrar from './compiled/RelayRegistrar.json'
import Penalizer from './compiled/Penalizer.json'
import Paymaster from './compiled/TestPaymasterEverythingAccepted.json'
import Forwarder from './compiled/Forwarder.json'
import TestWrappedNativeToken from './compiled/TestWrappedNativeToken.json'

import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { ServerConfigParams } from '@opengsn/relay/dist/ServerConfigParams'
import { Transaction, TypedTransaction } from '@ethereumjs/tx'
import { defaultGsnConfig } from '@opengsn/provider'

export interface RegisterOptions {
  /** ms to sleep if waiting for RelayServer to set its owner */
  sleepMs: number
  /** number of times to sleep before timeout */
  sleepCount: number
  from: Address
  token?: Address
  gasPrice?: string | BN
  stake: string
  wrap: boolean
  funds: string | BN
  relayUrl: string
  unstakeDelay: string
}

export interface WithdrawOptions {
  withdrawAmount: BN
  keyManager: KeyManager
  config: ServerConfigParams
  broadcast: boolean
  gasPrice?: BN
  withdrawTarget?: string
  useAccountBalance: boolean
}

interface DeployOptions {
  from: Address
  gasPrice: string
  gasLimit: number | IntString
  deployPaymaster?: boolean
  forwarderAddress?: string
  relayHubAddress?: string
  relayRegistryAddress?: string
  stakeManagerAddress?: string
  deployTestToken?: boolean
  stakingTokenAddress?: string
  minimumTokenStake: number | IntString
  penalizerAddress?: string
  burnAddress?: string
  devAddress?: string
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
  gasPrice: ow.string
}

interface RegistrationResult {
  success: boolean
  transactions?: string[]
  error?: string
}

type WithdrawalResult = RegistrationResult

export interface SendOptions {
  from: string
  gasPrice: number | string | BN
  gas: number | string | BN
  value: number | string | BN
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
    mnemonic?: string,
    derivationPath?: string,
    derivationIndex: string = '0',
    privateKey?: string
  ) {
    let provider: any = new Web3.providers.HttpProvider(host, {
      keepAlive: true,
      timeout: 120000
    })
    provider.sendAsync = provider.send.bind(provider)
    if (mnemonic != null || privateKey != null) {
      let hdWalletConstructorArguments: any
      if (mnemonic != null) {
        const addressIndex = parseInt(derivationIndex)
        hdWalletConstructorArguments = {
          mnemonic,
          derivationPath,
          addressIndex,
          provider
        }
      } else {
        hdWalletConstructorArguments = {
          privateKeys: [privateKey],
          provider
        }
      }
      provider = new HDWalletProvider(hdWalletConstructorArguments)
      const hdWalletAddress: string = provider.getAddress()
      console.log(`Using HDWalletProvider for address ${hdWalletAddress}`)
    }
    this.httpClient = new HttpClient(new HttpWrapper(), logger)
    const maxPageSize = Number.MAX_SAFE_INTEGER
    const environment = defaultEnvironment
    this.contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
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
      } catch (e: any) {
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

      const gasPrice = toHex(options.gasPrice ?? toBN(await this.getGasPrice()))
      const sendOptions: any = {
        chainId: toHex(await this.web3.eth.getChainId()),
        from: options.from,
        gas: 1e6,
        gasPrice
      }
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
      if (!isSameAddress(response.ownerAddress, options.from)) {
        throw new Error(`Relayer configured with wrong owner: ${response.ownerAddress}, our account: ${options.from}`)
      }
      const relayAddress = response.relayManagerAddress
      const relayHubAddress = response.relayHubAddress
      await this.contractInteractor._resolveDeploymentFromRelayHub(relayHubAddress)

      const relayHub = await this.contractInteractor.relayHubInstance
      const stakeManagerAddress = await relayHub.getStakeManager()
      const stakeManager = await this.contractInteractor._createStakeManager(stakeManagerAddress)
      const { stake, unstakeDelay, owner, token } = (await stakeManager.getStakeInfo(relayAddress))[0]

      let stakingToken = options.token
      if (stakingToken == null) {
        stakingToken = await this._findFirstToken(relayHubAddress)
      }

      if (!(isSameAddress(token, stakingToken) || isSameAddress(token, constants.ZERO_ADDRESS))) {
        throw new Error(`Cannot use token ${stakingToken}. Relayer already uses token: ${token}`)
      }
      const stakingTokenContract = await this.contractInteractor._createERC20(stakingToken)
      const tokenDecimals = await stakingTokenContract.decimals()
      const tokenSymbol = await stakingTokenContract.symbol()

      const stakeParam = toBN(toNumber(options.stake) * Math.pow(10, tokenDecimals.toNumber()))

      const formatToken = (val: any): string => formatTokenAmount(toBN(val.toString()), tokenDecimals, stakingToken ?? '', tokenSymbol)

      console.log('current stake= ', formatToken(stake))

      if (owner !== constants.ZERO_ADDRESS && !isSameAddress(owner, options.from)) {
        throw new Error(`Already owned by ${owner}, our account=${options.from}`)
      }

      const bal = await this.contractInteractor.getBalance(relayAddress)
      if (toBN(bal).gt(toBN(options.funds.toString()))) {
        console.log('Relayer already funded')
      } else {
        console.log('Funding relayer')

        const fundTx = await this.web3.eth.sendTransaction({
          ...sendOptions,
          to: relayAddress,
          value: options.funds
        })
        if (fundTx.transactionHash == null) {
          return {
            success: false,
            error: `Fund transaction reverted: ${JSON.stringify(fundTx)}`
          }
        }
        transactions.push(fundTx.transactionHash)
      }

      if (owner === constants.ZERO_ADDRESS) {
        let i = 0
        while (true) {
          console.debug(`Waiting ${options.sleepMs}ms ${i}/${options.sleepCount} for relayer to set ${options.from} as owner`)
          await sleep(options.sleepMs)
          const newStakeInfo = (await stakeManager.getStakeInfo(relayAddress))[0]
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
        stake.gte(stakeParam)
      ) {
        console.log('Relayer already staked')
      } else {
        const config = await relayHub.getConfiguration()
        const minimumStakeForToken = await relayHub.getMinimumStakePerToken(stakingToken)
        if (minimumStakeForToken.gt(toBN(stakeParam.toString()))) {
          throw new Error(`Given stake ${formatToken(stakeParam)} too low for the given hub ${formatToken(minimumStakeForToken)} and token ${stakingToken}`)
        }
        if (minimumStakeForToken.eqn(0)) {
          throw new Error(`Selected token (${stakingToken}) is not allowed in the current RelayHub`)
        }
        if (config.minimumUnstakeDelay.gt(toBN(options.unstakeDelay))) {
          throw new Error(`Given minimum unstake delay ${options.unstakeDelay.toString()} too low for the given hub ${config.minimumUnstakeDelay.toString()}`)
        }
        const stakeValue = stakeParam.sub(stake)
        console.log(`Staking relayer ${formatToken(stakeValue)}`,
          stake.toString() === '0' ? '' : ` (already has ${formatToken(stake)})`)

        const tokenBalance = await stakingTokenContract.balanceOf(options.from)
        if (tokenBalance.lt(stakeValue) && options.wrap) {
          // default token is wrapped eth, so deposit eth to make then into tokens.
          console.log(`Wrapping ${formatToken(stakeValue)}`)
          let depositTx: any
          try {
            depositTx = await stakingTokenContract.deposit({
              ...sendOptions,
              from: options.from,
              value: stakeValue
            }) as any
          } catch (e) {
            throw new Error('No deposit() method on default token. is it wrapped ETH?')
          }
          transactions.push(depositTx.transactionHash)
        }

        const currentAllowance = await stakingTokenContract.allowance(options.from, stakeManager.address)
        console.log('Current allowance', formatToken(currentAllowance))
        if (currentAllowance.lt(stakeValue)) {
          console.log(`Approving ${formatToken(stakeValue)} to StakeManager`)
          const approveTx = await stakingTokenContract.approve(stakeManager.address, stakeValue, {
            ...sendOptions,
            from: options.from
          })
          // @ts-ignore
          transactions.push(approveTx.transactionHash)
        }

        const stakeTx = await stakeManager
          .stakeForRelayManager(stakingToken, relayAddress, options.unstakeDelay.toString(), stakeValue, {
            ...sendOptions
          })
        // @ts-ignore
        transactions.push(stakeTx.transactionHash)
      }

      try {
        await relayHub.verifyRelayManagerStaked(relayAddress)
        console.log('Relayer already authorized')
      } catch (e: any) {
        // hide expected error
        if (e.message.match(/not authorized/) == null) {
          console.log('verifyRelayManagerStaked reverted with:', e.message)
        }
        console.log('Authorizing relayer for hub')
        const authorizeTx = await stakeManager
          .authorizeHubByOwner(relayAddress, relayHubAddress, sendOptions)
        // @ts-ignore
        transactions.push(authorizeTx.transactionHash)
      }

      await this.waitForRelay(options.relayUrl)
      return {
        success: true,
        transactions
      }
    } catch (error: any) {
      console.log(error)
      return {
        success: false,
        transactions,
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        error: error.message
      }
    }
  }

  async _findFirstToken (relayHubAddress: string): Promise<string> {
    const relayHub = await this.contractInteractor._createRelayHub(relayHubAddress)
    const fromBlock = await relayHub.getCreationBlock()
    const toBlock = Math.min(toNumber(fromBlock) + 5000, await this.contractInteractor.getBlockNumber())
    const tokens = await this.contractInteractor.getPastEventsForHub([], {
      fromBlock,
      toBlock
    }, ['StakingTokenDataChanged'])
    if (tokens.length === 0) {
      throw new Error(`no registered staking tokens on RelayHub ${relayHubAddress}`)
    }
    return tokens[0].returnValues.token
  }

  async displayManagerBalances (config: ServerConfigParams, keyManager: KeyManager): Promise<void> {
    const relayManager = keyManager.getAddress(0)
    console.log('relayManager is', relayManager)
    const relayHub = await this.contractInteractor._createRelayHub(config.relayHubAddress)
    const accountBalance = toBN(await this.contractInteractor.getBalance(relayManager))
    console.log(`Relay manager account balance is ${fromWei(accountBalance)}eth`)
    const hubBalance = await relayHub.balanceOf(relayManager)
    console.log(`Relay manager hub balance is ${fromWei(hubBalance)}eth`)
  }

  async withdrawToOwner (options: WithdrawOptions): Promise<WithdrawalResult> {
    const transactions: string[] = []
    try {
      const relayManager = options.keyManager.getAddress(0)
      console.log('relayManager is', relayManager)
      const relayHub = await this.contractInteractor._createRelayHub(options.config.relayHubAddress)
      const stakeManagerAddress = await relayHub.getStakeManager()
      const stakeManager = await this.contractInteractor._createStakeManager(stakeManagerAddress)
      const { owner } = (await stakeManager.getStakeInfo(relayManager))[0]
      if (options.config.ownerAddress != null) {
        // old (2.1.0) relayers didn't have owners in config.
        // but its OK to withdraw from them...
        if (owner.toLowerCase() !== options.config.ownerAddress.toLowerCase()) {
          throw new Error(`Owner in relayHub ${owner} is different than in server config ${options.config.ownerAddress}`)
        }
      }
      const withdrawTarget = options.withdrawTarget ?? owner

      const nonce = await this.contractInteractor.getTransactionCount(relayManager)
      const gasPrice = toHex(options.gasPrice ?? toBN(await this.getGasPrice()))
      const gasLimit = 1e5
      let txToSign: TypedTransaction
      if (options.useAccountBalance) {
        const balance = toBN(await this.contractInteractor.getBalance(relayManager))
        console.log(`Relay manager account balance is ${fromWei(balance)}eth`)
        if (balance.lt(options.withdrawAmount)) {
          throw new Error('Relay manager account balance lower than withdrawal amount')
        }
        const web3TxData = {
          to: withdrawTarget,
          value: options.withdrawAmount,
          gas: gasLimit,
          gasPrice,
          nonce
        }
        console.log('Calling in view mode', web3TxData)
        await this.contractInteractor.web3.eth.call({ ...web3TxData })
        const txData = { ...web3TxData, gasLimit: web3TxData.gas }
        // @ts-ignore
        delete txData.gas
        txToSign = new Transaction(txData, this.contractInteractor.getRawTxOptions())
      } else {
        const balance = await relayHub.balanceOf(relayManager)
        console.log(`Relay manager hub balance is ${fromWei(balance)}eth`)
        if (balance.lt(options.withdrawAmount)) {
          throw new Error('Relay manager hub balance lower than withdrawal amount')
        }
        const method = relayHub.contract.methods.withdraw(withdrawTarget, options.withdrawAmount)
        const encodedCall = method.encodeABI()
        txToSign = new Transaction({
          to: options.config.relayHubAddress,
          value: 0,
          gasLimit,
          gasPrice,
          data: Buffer.from(encodedCall.slice(2), 'hex'),
          nonce
        }, this.contractInteractor.getRawTxOptions())
        console.log('Calling in view mode')
        await method.call({
          from: relayManager,
          to: options.config.relayHubAddress,
          value: 0,
          gas: gasLimit,
          gasPrice
        })
      }
      console.log('Signing tx', txToSign.toJSON())
      const signedTx = options.keyManager.signTransaction(relayManager, txToSign)
      console.log(`signed withdrawal hex tx: ${signedTx.rawTx}`)
      if (options.broadcast) {
        console.log('broadcasting tx')
        const txHash = await this.contractInteractor.broadcastTransaction(signedTx.rawTx)
        transactions.push(txHash)
      }
      return {
        success: true,
        transactions
      }
    } catch (e: any) {
      console.log(e)
      return {
        success: false,
        transactions,
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        error: e.message
      }
    }
  }

  contract (file: any, address?: string): Contract {
    const abi = file.abi ?? file
    return new this.web3.eth.Contract(abi, address, { data: file.bytecode })
  }

  async deployGsnContracts (deployOptions: DeployOptions): Promise<GSNContractsDeployment> {
    ow(deployOptions, ow.object.partialShape(DeployOptionsPartialShape))
    const options: Required<SendOptions> = {
      from: deployOptions.from,
      gas: deployOptions.gasLimit,
      value: 0,
      gasPrice: deployOptions.gasPrice
    }

    const rrInstance = await this.getContractInstance(RelayRegistrar, {
      arguments: [
        constants.yearInSec
      ]
    }, deployOptions.relayRegistryAddress, { ...options }, deployOptions.skipConfirmation)
    const sInstance = await this.getContractInstance(StakeManager, {
      arguments: [defaultEnvironment.maxUnstakeDelay, defaultEnvironment.abandonmentDelay, defaultEnvironment.escheatmentDelay, deployOptions.burnAddress, deployOptions.devAddress]
    }, deployOptions.stakeManagerAddress, { ...options }, deployOptions.skipConfirmation)
    const pInstance = await this.getContractInstance(Penalizer, {
      arguments: [
        deployOptions.penalizerConfiguration.penalizeBlockDelay,
        deployOptions.penalizerConfiguration.penalizeBlockExpiration
      ]
    }, deployOptions.penalizerAddress, { ...options }, deployOptions.skipConfirmation)
    const fInstance = await this.getContractInstance(Forwarder, {}, deployOptions.forwarderAddress, { ...options }, deployOptions.skipConfirmation)
    // TODO: add support to passing '--batchGatewayAddress'
    const batchGatewayAddress = constants.ZERO_ADDRESS
    const rInstance = await this.getContractInstance(RelayHub, {
      arguments: [
        sInstance.options.address,
        pInstance.options.address,
        batchGatewayAddress,
        rrInstance.options.address,
        deployOptions.relayHubConfiguration
      ]
    }, deployOptions.relayHubAddress, { ...options }, deployOptions.skipConfirmation)

    if (!isSameAddress(await rInstance.methods.getRelayRegistrar().call(), rrInstance.options.address)) {
      await rInstance.methods.setRegistrar(rrInstance.options.address).send({ ...options })
    }

    let pmInstance: Contract | undefined
    if (deployOptions.deployPaymaster ?? false) {
      pmInstance = await this.deployPaymaster({ ...options }, rInstance.options.address, fInstance, deployOptions.skipConfirmation)
    }
    await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, fInstance, console, options)

    let stakingTokenAddress = deployOptions.stakingTokenAddress

    let ttInstance: Contract | undefined
    if (deployOptions.deployTestToken ?? false) {
      ttInstance = await this.getContractInstance(TestWrappedNativeToken, {}, undefined, { ...options }, deployOptions.skipConfirmation)
      console.log('Setting minimum stake of 1 TestWeth on Hub')
      await rInstance.methods.setMinimumStakes([ttInstance.options.address], [1e18.toString()]).send({ ...options })
      stakingTokenAddress = ttInstance.options.address
    }

    const stakingTokenContract = await this.contractInteractor._createERC20(stakingTokenAddress ?? '')
    const tokenDecimals = await stakingTokenContract.decimals()
    const tokenSymbol = await stakingTokenContract.symbol()

    const formatToken = (val: any): string => formatTokenAmount(toBN(val.toString()), tokenDecimals, stakingTokenAddress ?? '', tokenSymbol)

    console.log(`Setting minimum stake of ${formatToken(deployOptions.minimumTokenStake)}`)
    await rInstance.methods.setMinimumStakes([stakingTokenAddress], [deployOptions.minimumTokenStake]).send({ ...options })
    this.deployment = {
      relayHubAddress: rInstance.options.address,
      stakeManagerAddress: sInstance.options.address,
      penalizerAddress: pInstance.options.address,
      relayRegistrarAddress: rrInstance.options.address,
      forwarderAddress: fInstance.options.address,
      managerStakeTokenAddress: stakingTokenAddress,
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
      const estimatedGasCost = await sendMethod.estimateGas()
      const maxCost = toBN(options.gasPrice.toString()).mul(toBN(options.gas.toString()))
      console.log(`Deploying ${contractName} contract with gas limit of ${options.gas.toLocaleString()} at ${fromWei(options.gasPrice.toString(), 'gwei')}gwei (estimated gas: ${estimatedGasCost.toLocaleString()}) and maximum cost of ~ ${fromWei(maxCost)} ETH`)
      if (!skipConfirmation) {
        await this.confirm()
      }
      // @ts-ignore - web3 refuses to accept string as gas limit, and max for a number in BN is 0x4000000 (~67M)
      const deployPromise = sendMethod.send({ ...options })
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deployPromise.on('transactionHash', function (hash) {
        console.log(`Transaction broadcast: ${hash}`)
      })
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      deployPromise.on('error', function (err: Error) {
        console.debug(`tx error: ${err.message}`)
      })
      contractInstance = await deployPromise
      console.log(`Deployed ${contractName} at address ${contractInstance.options.address}\n\n`)
    } else {
      console.log(`Using ${contractName} at given address ${address}\n\n`)
      contractInstance = this.contract(json, address)
    }
    return contractInstance
  }

  async deployPaymaster (options: Required<SendOptions>, hub: Address, fInstance: Contract, skipConfirmation: boolean | undefined): Promise<Contract> {
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

  async getGasPrice (): Promise<string> {
    const gasPrice = await this.contractInteractor.getGasPrice()
    console.log(`Using network gas price of ${fromWei(gasPrice, 'gwei')}`)
    return gasPrice
  }
}
