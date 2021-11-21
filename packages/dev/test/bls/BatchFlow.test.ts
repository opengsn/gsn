import { constants, defaultEnvironment } from '@opengsn/common'
import { deployHub, startRelay } from '../TestUtils'
import {
  BLSBatchGatewayInstance,
  BatchGatewayCacheDecoderInstance,
  ERC20CacheDecoderInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestTokenInstance,
  GatewayForwarderInstance,
  BLSAddressAuthorizationsRegistrarInstance
} from '@opengsn/contracts'
import { ChildProcessWithoutNullStreams } from 'child_process'

const StakeManager = artifacts.require('StakeManager')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

contract('Batch Relaying Flow', function ([a, relayOwner]: string[]) {
  let testToken: TestTokenInstance

  // unmodified GSN components
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let stakeManager: StakeManagerInstance

  // modified GSN components
  let relayHub: RelayHubInstance

  // other stuff
  // let bathingRelayProvider:

  let relayProcess: ChildProcessWithoutNullStreams

  before(async function () {
    paymaster = await TestPaymasterEverythingAccepted.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    relayHub = await deployHub(stakeManager.address, constants.ZERO_ADDRESS)

    // 2. start batch server
    relayProcess = await startRelay(relayHub.address, stakeManager, {
      runBatching: true,
      stake: 1e18,
      relayOwner,
      // @ts-ignore
      ethereumNodeUrl: web3.currentProvider.host
    })

    // @ts-ignore
    TestRecipient.web3.setProvider(bathingRelayProvider)
  })

  it('should relay batch', async function () {
    // 3. add request to batch from1

    // 4. add request to batch from2
    // 5. [non-core API] ask server for status and see 'batching' state
    // 6. [non-core API] wait; see state become 'tx broadcast'
    // 7. await batch transaction result by RelayRequest ID
    // 8. observe only necessary target contract events from the stubbed receipt
  })
})
