import { LogCallback } from 'winston'

/**
 * Winston logger allows chaining, but not all loggers do.
 * In order to allow swapping logger implementations this interface hides this feature.
 * See {@link LeveledLogMethod}
 */
interface LeveledLogMethodNoChaining {
  (message: string, callback: LogCallback): void

  (message: string, meta: any, callback: LogCallback): void

  (message: string, ...meta: any[]): void

  (message: any): void

  (infoObject: object): void
}

export interface LoggerInterface {
  error: LeveledLogMethodNoChaining
  warn: LeveledLogMethodNoChaining
  info: LeveledLogMethodNoChaining
  debug: LeveledLogMethodNoChaining
}
