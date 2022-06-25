import { LoggerInterface, ContractInteractor } from '@opengsn/common'

import axios from 'axios'

export class GasPriceFetcher {
  constructor (readonly gasPriceOracleUrl: string, readonly gasPriceOraclePath: string,
    readonly contractInteractor: ContractInteractor,
    readonly logger: LoggerInterface) {
  }

  // equivalent to `eval("blob"+path)` - but without evil eval
  // path is sequence of `.word` , `[number]`, `["string"]`
  getJsonElement (blob: any, path: string, origPath = path): string | null {
    const m = path.match(/^\.(\w+)|\["([^"]+)"\]|\[(\d+)\]/)
    if (m == null) throw new Error(`invalid path: ${origPath}: head of ${path}`)
    const rest = path.slice(m[0].length)
    const subitem = m[1] ?? m[2] ?? m[3]
    const sub = blob[subitem]
    if (sub == null) {
      return null
    }
    if (rest === '') {
      return sub
    }
    return this.getJsonElement(sub, rest, origPath)
  }

  async getGasPrice (): Promise<string> {
    if (this.gasPriceOracleUrl !== '') {
      try {
        const res = await axios.get(this.gasPriceOracleUrl, { timeout: 2000 })
        const ret = parseFloat(this.getJsonElement(res.data, this.gasPriceOraclePath) ?? '')
        if (typeof ret !== 'number' || isNaN(ret)) {
          throw new Error(`not a number: ${ret}`)
        }
        return (ret * 1e9).toString()
      } catch (e: any) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        this.logger.error(`failed to access gas oracle. using getGasPrice() instead.\n(url=${this.gasPriceOracleUrl} path=${this.gasPriceOraclePath} err: ${e.message})`)
      }
    }

    return await this.contractInteractor.getGasPrice()
  }
}
