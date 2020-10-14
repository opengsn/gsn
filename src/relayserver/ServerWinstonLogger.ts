import winston, { Logger, transport } from 'winston'
import { ConsoleTransportOptions, HttpTransportOptions } from 'winston/lib/winston/transports'
import { URL } from 'url'

import { gsnRuntimeVersion } from '../common/Version'

import { NpmLogLevel } from '../relayclient/types/Aliases'

const service = 'gsn-server'
const filename = 'combined.log'

const format = winston.format.combine(
  winston.format.uncolorize(),
  winston.format.timestamp(),
  winston.format.simple()
)

const consoleOptions: ConsoleTransportOptions = {
  format: winston.format.combine(
    winston.format.cli()
  )
}

export function createLogger (level: NpmLogLevel, loggerUrl: string, userId: string): Logger {
  const transports: transport[] = [
    new winston.transports.Console(consoleOptions),
    new winston.transports.File({ format, filename })
  ]
  let isCollectingLogs = false
  if (loggerUrl.length !== 0 && userId.length !== 0) {
    const url = new URL(loggerUrl)
    const host = url.host
    const path = url.pathname
    const headers = { 'content-type': 'text/plain' }
    isCollectingLogs = true
    const httpTransportOptions: HttpTransportOptions = {
      format,
      host,
      path,
      headers
    }
    transports.push(new winston.transports.Http(httpTransportOptions))
  }
  const logger = winston.createLogger({
    level,
    defaultMeta: {
      version: gsnRuntimeVersion,
      service,
      userId: userId ?? ''
    },
    transports
  })
  logger.debug(`Created logger for ${userId}; remote logs collecting: ${isCollectingLogs}`)
  return logger
}
