// accessor class for the on-chain version registry
import { PrefixedHexString } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { Contract } from 'web3-eth-contract'

import versionRegistryAbi from '../common/interfaces/IVersionRegistry.json'
import Web3 from 'web3'

export function string32 (s: string): PrefixedHexString {
  return bufferToHex(Buffer.from(s)).padEnd(66, '0')
}

// convert a bytes32 into a string, removing any trailing zeros
export function bytes32toString (s: PrefixedHexString): string {
  return Buffer.from(s.replace(/^(?:0x)?(.*?)(00)*$/, '$1'), 'hex').toString()
}

export interface VersionInfo {
  value: string
  version: string
  time: number
  canceled: boolean
}

export class VersionRegistry {
  registryContract: Contract
  web3: Web3

  constructor (web3provider: any, registryAddress: PrefixedHexString) {
    this.web3 = new Web3(web3provider)
    this.registryContract = new this.web3.eth.Contract(versionRegistryAbi as any, registryAddress)
  }

  /**
   * return the latest "mature" version from the registry
   *
   * @param id object id to return a version for
   * @param delayPeriod - don't return entries younger than that (in seconds)
   * @param optInVersion - if set, return this version even if it is young
   * @return version info that include actual version used, its timestamp and value.
   */
  async getVersion (id: string, delayPeriod: number, optInVersion = ''): Promise<VersionInfo> {
    const [versions, now] = await Promise.all([
      await this.getAllVersions(id),
      await this.web3.eth.getBlock('latest').then(b => b.timestamp as number)
    ])
    const ver = versions
      .find(v => !v.canceled && (v.time + delayPeriod <= now || v.version === optInVersion))
    if (ver == null) { throw new Error(`getVersion(${id}) - no version found`) }

    return ver
  }

  /**
   * return all version history of the given id
   * @param id object id to return version history for
   */
  async getAllVersions (id: string): Promise<VersionInfo[]> {
    const events = await this.registryContract.getPastEvents('allEvents', { fromBlock: 1, topics: [null, string32(id)] })
    const canceled = new Set<string>(events.filter(e => e.event === 'VersionCanceled').map(e => e.returnValues.version))
    const found = new Set<string>()
    return events
      .filter(e => e.event === 'VersionAdded')
      .map(e => ({
        version: bytes32toString(e.returnValues.version),
        canceled: canceled.has(e.returnValues.version),
        value: e.returnValues.value,
        time: parseInt(e.returnValues.time)
      }))
      .filter(e => {
        // use only the first occurrence of each version
        if (found.has(e.version)) {
          return false
        } else {
          found.add(e.version)
          return true
        }
      })
      .reverse()
  }
}
