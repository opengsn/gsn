import { StaticJsonRpcProvider } from '@ethersproject/providers'

export class ProfilingProvider extends StaticJsonRpcProvider {
  methodsCount = new Map<string, number>()
  requestsCount = 0

  logTraffic: boolean

  constructor (host: string, logTraffic: boolean = false) {
    super(host)
    this.logTraffic = logTraffic
  }

  async send (method: string, params: any[]): Promise<any> {
    this.requestsCount++
    const currentCount = this.methodsCount.get(method) ?? 0
    this.methodsCount.set(method, currentCount + 1)
    if (this.logTraffic) {
      console.log(`>>> payload: "${method}" [${JSON.stringify(params)}]`)
    }
    try {
      const result = await super.send(method, params)
      if (this.logTraffic) {
        console.log(`<<< result: ${JSON.stringify(result) ?? 'null result'}`)
      }
      return result
    } catch (error: any) {
      if (this.logTraffic) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`<<< error: ${error.message ?? 'null error message'}`)
      }
      throw error
    }
  }

  reset (): void {
    this.requestsCount = 0
    this.methodsCount.clear()
  }

  log (): void {
    console.log('Profiling Provider Stats:')
    new Map([...this.methodsCount.entries()].sort(function ([, count1], [, count2]) {
      return count2 - count1
    })).forEach(function (value, key) {
      console.log(`Method: ${key.padEnd(30)} was called: ${value.toString().padEnd(3)} times`)
    })
    console.log(`Total RPC calls: ${this.requestsCount}`)
  }
}
