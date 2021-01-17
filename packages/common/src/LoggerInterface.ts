type LogMethod = (msg: string) => void

export interface LoggerInterface {
  error: LogMethod
  warn: LogMethod
  info: LogMethod
  debug: LogMethod
}
