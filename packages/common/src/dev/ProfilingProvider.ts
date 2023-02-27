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
    // let wrappedCallback: SendCallback = callback
    // TODO: reimplement logging
    // if (this.logTraffic) {
    //   wrappedCallback = function (error: (Error | null), result?: JsonRpcResponse): void {
    //     if (error != null) {
    //       console.log(`<<< error: ${error.message ?? 'null error message'}`)
    //     }
    //     console.log(`<<< result: ${JSON.stringify(result) ?? 'null result'}`)
    //     callback(error, result)
    //   }
    //   console.log(`>>> payload: ${JSON.stringify(payload) ?? 'null result'}`)
    // }
    return await super.send(method, params)
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
