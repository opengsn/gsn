import log from 'loglevel'
import winston, { transport } from 'winston'
import { HttpTransportOptions } from 'winston/lib/winston/transports'
import { URL } from 'url'

import { NpmLogLevel } from './types/Aliases'
import { gsnRuntimeVersion } from '../common/Version'
import { LoggerInterface } from '../common/LoggerInterface'

const format = winston.format.combine(
  winston.format.uncolorize(),
  winston.format.timestamp(),
  winston.format.simple()
)

const service = 'gsn-client'
const userIdKey = 'gsn-client-user-id'

const isBrowser = typeof window !== 'undefined'

function createUserId (): string {
  const userId = `${userIdKey}${Date.now()}`
  window.localStorage.set(userIdKey, userId)
  return userId
}

export function createLogger (level: NpmLogLevel, loggerUrl: string, userIdOverride: string): LoggerInterface {
  if (loggerUrl.length === 0 || window == null || window.localStorage == null) {
    log.setLevel(level)
    return log
  }
  const url = new URL(loggerUrl)
  const host = url.host
  const path = url.pathname
  const headers = { 'content-type': 'text/plain' }
  const httpTransportOptions: HttpTransportOptions = {
    format,
    host,
    path,
    headers
  }

  const transports: transport[] = [
    new winston.transports.Console(),
    new winston.transports.Http(httpTransportOptions)
  ]
  let userId: string
  if (userIdOverride.length !== 0) {
    userId = userIdOverride
  } else {
    userId = window.localStorage.get(userIdKey) ?? createUserId()
  }
  const logger = winston.createLogger({
    level,
    defaultMeta: {
      version: gsnRuntimeVersion,
      service,
      isBrowser,
      userId
    },
    transports
  })
  logger.debug(`Created remote logs collecting logger for ${userId}`)
  return logger
}
