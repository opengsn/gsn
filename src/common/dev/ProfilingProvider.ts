import { HttpProvider } from 'web3-core'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { SendCallback } from './SendCallback'
import { WrapperProviderBase } from './WrapperProviderBase'

export class ProfilingProvider extends WrapperProviderBase {
  methodsCount = new Map<string, number>()
  requestsCount = 0

  logTraffic: boolean

  constructor (provider: HttpProvider, logTraffic: boolean = false) {
    super(provider)
    this.logTraffic = logTraffic
  }

  disconnect (): boolean {
    return false
  }

  supportsSubscriptions (): boolean {
    return false
  }

  send (payload: JsonRpcPayload, callback: SendCallback): void {
    this.requestsCount++
    const currentCount = this.methodsCount.get(payload.method) ?? 0
    this.methodsCount.set(payload.method, currentCount + 1)
    let wrappedCallback: SendCallback = callback
    if (this.logTraffic) {
      wrappedCallback = function (error: (Error | null), result?: JsonRpcResponse): void {
        if (error != null) {
          console.log(`<<< error: ${error.message ?? 'null error message'}`)
        }
        console.log(`<<< result: ${JSON.stringify(result) ?? 'null result'}`)
        callback(error, result)
      }
      console.log(`>>> payload: ${JSON.stringify(payload) ?? 'null result'}`)
    }
    this.provider.send(payload, wrappedCallback)
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
