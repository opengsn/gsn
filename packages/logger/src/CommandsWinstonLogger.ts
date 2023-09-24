import winston, { type transport } from 'winston'

import { type NpmLogLevel, type LoggerInterface } from '@opengsn/common'

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
