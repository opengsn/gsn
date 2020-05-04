import Web3 from 'web3'

import CommandsLogic, { DeploymentResult } from '../cli/CommandsLogic'
import { GsnDevProvider } from './GsnDevProvider'
import { configureGSN } from './GSNConfigurator'
import { DevGSNConfig } from './DevRelayClient'
import { networks } from '../cli/utils'

interface TestEnvironment {
  deployment: DeploymentResult
  devProvider: GsnDevProvider
}

class GsnTestClass {
  private fixture?: TestEnvironment

  /**
   *
   * @param host
   * @param paymaster TODO: will allow using custom paymaster (need to provide ABI file contents)
   * @return
   */
  async start (host?: string, paymaster?: any): Promise<void> {
    const _host: string = host ?? networks.get('localhost') ?? ''
    const commandsLogic = new CommandsLogic(_host, configureGSN({}))
    const from = await commandsLogic.findWealthyAccount()
    if (from == null) {
      throw new Error('could not get unlocked account with sufficient balance')
    }
    const deployment = await commandsLogic.deployRelayHub(from, undefined, paymaster)
    const httpProvider = new Web3.providers.HttpProvider(_host)

    const devConfig: DevGSNConfig = {
      relayOwner: from,
      relayHubAddress: deployment.relayHubAddress,
      gasPriceFactor: 1,
      baseRelayFee: 0,
      pctRelayFee: 0
    }

    const devProvider = new GsnDevProvider(httpProvider, devConfig)
    this.fixture = {
      deployment,
      devProvider
    }
  }

  getTestEnvironment (): TestEnvironment {
    if (this.fixture == null) {
      throw new Error('You must call `await GsnTest.start()` first!')
    }
    return this.fixture
  }
}

const GsnTest = new GsnTestClass()
export default GsnTest
