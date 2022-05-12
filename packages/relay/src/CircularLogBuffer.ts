import { NpmLogLevel } from '@opengsn/common/dist/types/Aliases'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

export class CircularLogBuffer {
  logs: Array<Array<[NpmLogLevel, string]>> = []
  private readonly iterations: number
  private lastIndex = 0

  constructor (iterations: number) {
    this.iterations = iterations
    this.logs = new Array(iterations)
    for (let i = 0; i < iterations; i++) {
      this.logs[i] = []
    }
  }

  append (level: NpmLogLevel, log: string): void {
    this.logs[this.lastIndex].push([level, log])
  }

  nextIteration (): void {
    this.lastIndex = (this.lastIndex + 1) % this.iterations
    this.logs[this.lastIndex] = []
  }

  log (logger: LoggerInterface): void {
    for (let i = 0; i < this.iterations; i++) {
      for (const log of this.logs[(this.lastIndex + i) % this.iterations]) {
        logger[log[0]](log[1])
      }
    }
    this.logs = []
  }
}
