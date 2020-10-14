/**
 * Winston logger allows chaining, but not all loggers do.
 * In order to allow swapping logger implementations this interface hides this feature.
 * See {@link LeveledLogMethod}
 */
type LogMethod = (msg: string) => void

export interface LoggerInterface {
  error: LogMethod
  warn: LogMethod
  info: LogMethod
  debug: LogMethod
}
