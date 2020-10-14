import winston, { transport } from 'winston'

import { NpmLogLevel } from '../relayclient/types/Aliases'
import { LoggerInterface } from '../common/LoggerInterface'

const format = winston.format.combine(
  winston.format.cli()
)

export function createLogger (level: NpmLogLevel): LoggerInterface {
  const transports: transport[] = [
    new winston.transports.Console({ format })
  ]
  return winston.createLogger({
    level,
    transports
  })
}
