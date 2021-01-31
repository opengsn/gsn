import Web3 from 'web3'

import ContractInteractor from '../../common/ContractInteractor'
import HttpClient from '../../relayclient/HttpClient'
import HttpWrapper from '../../relayclient/HttpWrapper'
import { GSNContractsDeployment } from '../../common/GSNContractsDeployment'

import { getNetworkUrl, getRelayHubAddress, gsnCommander } from '../utils'
import StatusLogic from '../StatusLogic'
import { createCommandsLogger } from '../CommandsWinstonLogger'

const commander = gsnCommander(['n', 'h'])
  .parse(process.argv);

(async () => {
  const host = getNetworkUrl(commander.network)
  const relayHubAddress = getRelayHubAddress(commander.hub)

  if (relayHubAddress == null) {
    console.error('Please specify RelayHub address')
    process.exit(1)
  }

  const statusConfig = {
    blockHistoryCount: 6000,
    getAddressTimeout: 1000,
    relayHubAddress
  }

  const deployment: GSNContractsDeployment = { relayHubAddress }
  const logger = createCommandsLogger(commander.loglevel)
  const provider = new Web3.providers.HttpProvider(host)
  const contractInteractor = new ContractInteractor({ provider, logger, deployment })
  await contractInteractor.init()
  const httpClient = new HttpClient(new HttpWrapper({ timeout: statusConfig.getAddressTimeout }), logger)

  const statusLogic = new StatusLogic(contractInteractor, httpClient, statusConfig)

  const statistics = await statusLogic.gatherStatistics()

  console.log(`Total stakes by all relays: ${Web3.utils.fromWei(statistics.totalStakesByRelays)} ETH`)
  console.log(`Hub address: ${relayHubAddress}`)

  console.log('\n# Relays:')
  statistics.relayRegisteredEvents.forEach(registeredEvent => {
    const res = []
    res.push(registeredEvent.relayManager)
    res.push(registeredEvent.relayUrl)
    res.push(`\tfee: ${registeredEvent.baseRelayFee} wei + ${registeredEvent.pctRelayFee}%`)
    const managerBalance = statistics.balances.get(registeredEvent.relayManager)
    if (managerBalance == null) {
      res.push('\tbalance: N/A')
    } else {
      res.push(`\tbalance: ${Web3.utils.fromWei(managerBalance)} ETH`)
    }
    const pingResult = statistics.relayPings.get(registeredEvent.relayUrl)
    const status = pingResult?.pingResponse != null ? pingResult.pingResponse.ready.toString() : pingResult?.error?.toString() ?? 'unknown'
    res.push(`\tstatus: ${status}`)
    console.log('- ' + res.join(' '))
  })
  /*
    console.log('\n# Owners:')
    Object.keys(owners).forEach(k => {
      const ethBalance = web3.eth.getBalance(k)
      const relayBalance = r.methods.balanceOf(k).call()
      Promise.all([ethBalance, relayBalance])
        .then(async () => {
          // @ts-ignore
          console.log('-', owners[k], ':', k, 'on-hub:', (await relayBalance) / 1e18, '\tbal', (await ethBalance) / 1e18)
        })
        .catch(reason => {
          console.error(reason)
        })
    })
  */
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
