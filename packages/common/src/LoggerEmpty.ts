import { LoggerInterface } from './LoggerInterface'

export class LoggerEmpty implements LoggerInterface {
  debug (msg: string): void {
    console.debug(msg)
  }

  error (msg: string): void {
    console.error(msg)
  }

  info (msg: string): void {
    console.info(msg)
  }

  warn (msg: string): void {
    console.warn(msg)
  }
}
