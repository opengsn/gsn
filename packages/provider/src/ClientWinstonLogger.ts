import log from 'loglevel'
import winston, { transport } from 'winston'
import { HttpTransportOptions } from 'winston/lib/winston/transports'

import { gsnRuntimeVersion, LoggerInterface, LoggerConfiguration } from '@opengsn/common'

const format = winston.format.combine(
  winston.format.uncolorize(),
  winston.format.timestamp(),
  winston.format.simple()
)

const service = 'gsn-client'
const userIdKey = 'gsnuser'

const isBrowser = typeof window !== 'undefined'

function getOrCreateUserId (): string {
  let userId = window.localStorage[userIdKey]
  if (userId == null) {
    userId = `${userIdKey}${Date.now() % 1000000}`
    window.localStorage[userIdKey] = userId
  }
  return userId
}

export function createClientLogger (loggerConfiguration?: LoggerConfiguration): LoggerInterface {
  loggerConfiguration = loggerConfiguration ?? { logLevel: 'info' }
  if (loggerConfiguration.loggerUrl == null || typeof window === 'undefined' || window.localStorage == null) {
    log.setLevel(loggerConfiguration.logLevel)
    return log
  }

  const url = new URL(loggerConfiguration.loggerUrl)
  const host = url.host
  const path = url.pathname
  const ssl = url.protocol === 'https:'
  const headers = { 'content-type': 'text/plain' }
  const httpTransportOptions: HttpTransportOptions = {
    ssl,
    format,
    host,
    path,
    headers
  }

  const transports: transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.Http(httpTransportOptions)
  ]
  let userId: string
  if (loggerConfiguration.userId != null) {
    userId = loggerConfiguration.userId
  } else {
    userId = getOrCreateUserId()
  }

  const localhostRegExp: RegExp = /http:\/\/(localhost)|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
  let applicationId = loggerConfiguration.applicationId
  if (loggerConfiguration.applicationId == null && window?.location?.href != null && window.location.href.match(localhostRegExp) == null) {
    applicationId = window.location.href
  }
  const logger = winston.createLogger({
    level: loggerConfiguration.logLevel,
    defaultMeta: {
      version: gsnRuntimeVersion,
      service,
      isBrowser,
      applicationId,
      userId
    },
    transports
  })
  logger.debug(`Created remote logs collecting logger for userId: ${userId} and applicationId: ${applicationId}`)
  if (applicationId == null) {
    logger.warn('application ID is not set!')
  }
  return logger
}
