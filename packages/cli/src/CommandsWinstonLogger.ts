import winston, { transport } from 'winston'

import { NpmLogLevel } from '@opengsn/common/dist/types/Aliases'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

const format = winston.format.combine(
  winston.format.cli()
)

export function createCommandsLogger (level: NpmLogLevel): LoggerInterface {
  const transports: transport[] = [
    new winston.transports.Console({ format })
  ]
  return winston.createLogger({
    level,
    transports
  })
}
