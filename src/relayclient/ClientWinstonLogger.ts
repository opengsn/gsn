import Cookies from 'js-cookie'
import log from 'loglevel'
import winston, { transport } from 'winston'
import { HttpTransportOptions } from 'winston/lib/winston/transports'

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
  Cookies.set(userIdKey, userId)
  return userId
}

export function createLogger (level: NpmLogLevel, customerToken: string, hostOverride: string, userIdOverride: string): LoggerInterface {
  if (customerToken.length === 0) {
    log.setLevel(level)
    return log
  }
  const host = hostOverride.length === 0 ? 'logs-01.loggly.com' : hostOverride
  const httpTransportOptions: HttpTransportOptions = {
    format,
    host,
    path: `/inputs/${customerToken}/tag/http/`,
    headers:
      { 'content-type': 'text/plain' }
  }

  const transports: transport[] = [
    new winston.transports.Console(),
    new winston.transports.Http(httpTransportOptions)
  ]
  let userId: string
  if (userIdOverride.length !== 0) {
    userId = userIdOverride
  } else {
    userId = Cookies.get(userIdKey) ?? createUserId()
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
