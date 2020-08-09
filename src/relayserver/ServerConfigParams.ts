import parseArgs from 'minimist'
import * as fs from "fs";
import {VersionOracle} from "../common/VersionOracle";

require('source-map-support').install({errorFormatterForce: true})

const ConfigParamsTypes = {
  config: 'string',
  baseRelayFee: 'number',
  pctRelayFee: 'number',
  url: 'string',
  port: 'number',
  versionOracleAddress: 'string',
  versionOracleDelayPeriod: 'number',
  relayHubId: 'string',
  relayHubAddress: 'string',
  gasPricePercent: 'number',
  ethereumNodeUrl: 'string',
  workdir: 'string',
  devMode: 'boolean',
  debug: 'boolean',
  registrationBlockRate: 'number'
} as any

const globalDefaults = {
  versionOracleDelayPeriod: 3600 * 24 * 7,
  devMode: false,
  debug: false,
}

function error(err: string): void {
  throw new Error(err)
}

//get the keys matching specific type from ConfigParamsType
export function filterType(config: any, type: string) {
  return Object.entries(config).flatMap(e => e[1] === type ? [e[0]] : [])
}

//convert [key,val] array (created by Object.entries) back to an object.
export function entriesToObj(entries: any[]): any {
  return entries
    .reduce((set: any, [k, v]) => ({...set, [k]: v}), {});
}

//filter and return from env only members that appear in "config"
export function filterMembers(env: any, config: any) {
  return entriesToObj(Object.entries(env)
    .filter(e => config[e[0]] != undefined))
}

//map value from string into its explicit type (number, boolean)
//TODO; maybe we can use it for more specific types, such as "address"..
function explicitType([key, val]: [string, any]) {
  const type = ConfigParamsTypes[key]
  if ( type === undefined ) {
    error(`unexpected param ${key}=${val}`)
  }
  switch (type) {
    case 'boolean' :
      if (val === 'true' || val === true) return [key, true]
      if (val === 'false' || val === false) return [key, false]
      break
    case 'number':
      const v = parseInt(val)
      if (v !== NaN)
        return [key, v]
      break
    default:
      return [key, val]
  }
  error(`Invalid ${type}: ${key} = ${val}`)
}

/**
 * initialize each parameter from commandline, env or config file (in that order)
 * config file must be provided either as command-line or env (obviously, not in
 * the config file..)
 */
export function parseServerConfig(args: string[], env: any): any {
  const envDefaults = filterMembers(env, ConfigParamsTypes)

  const argv = parseArgs(args, {
    string: filterType(ConfigParamsTypes, 'string'),
    // boolean: filterType(ConfigParamsTypes, 'boolean'),
    default: envDefaults
  })
  if (argv._.length > 0) {
    error('unexpected param ' + argv._)
  }
  delete argv._
  let configFile = {}
  if (argv.config != null) {
    if (!fs.existsSync(argv.config))
      error(`unable to read config file "${argv.config}"`)
    configFile = JSON.parse(fs.readFileSync(argv.config, 'utf8'))
  }
  const config = {...configFile, ...argv}
  return entriesToObj(Object.entries(config).map(explicitType))
}
