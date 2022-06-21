import { toBN } from 'web3-utils'
import { AsyncScoreCalculator, environments } from '@opengsn/common'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayRegisteredEventInfo } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { RelayInfo } from './RelayInfo'

export const DefaultRelayScore: AsyncScoreCalculator = async function (info: RelayInfo[], transactionDetails: GsnTransactionDetails): Promise<RelayInfo[]> {
  const gasLimit = toBN(transactionDetails.gas ?? '')
  const maxFeePerGas = toBN(transactionDetails.maxFeePerGas ?? '')
  info.forEach(it => {
    const registrarInfo = it.registrarInfo
  if (registrarInfo == null){
    throw new Error('Failed to calculate relay score: missing Registrar Info')
  }
    const txCost = toBN(registrarInfo.baseRelayFee).add(gasLimit.mul(maxFeePerGas).muln((100 + parseInt(registrarInfo.pctRelayFee)) / 100))
    const invertedTxCost = toBN(2).pow(toBN(80)).div(txCost)
    // make exponential to favor cheaper relays;
    it.score = invertedTxCost.pow(toBN(6))
  })

  const sortedCheapToHigh: RelayInfo[] =
    info
      .sort((a, b) => {
        return a.score?.cmp(b.score ?? toBN(0)) ?? 0
      })

  for (let i = 1; i < sortedCheapToHigh.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    sortedCheapToHigh[i].score = sortedCheapToHigh[i - 1].score!.add(sortedCheapToHigh[i].score!)
  }
  return sortedCheapToHigh
}
