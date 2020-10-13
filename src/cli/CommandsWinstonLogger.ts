import winston, { Logger, transport } from 'winston'

import { NpmLogLevel } from '../relayclient/types/Aliases'

const format = winston.format.combine(
  winston.format.cli()
)

export function createLogger (level: NpmLogLevel): Logger {
  const transports: transport[] = [
    new winston.transports.Console({ format })
  ]
  return winston.createLogger({
    level,
    transports
  })
}
