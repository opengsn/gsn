// accessor class for the on-chain version oracle
import { PrefixedHexString } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { Contract } from 'web3-eth-contract'

import versionOracleAbi from '../common/interfaces/IVersionOracle.json'
import Web3 from 'web3'

export function string32 (s: string): PrefixedHexString {
  return bufferToHex(Buffer.from(s))
}

// convert a bytes32 into a string, removing any trailing zeros
export function bytes32toString (s: PrefixedHexString): string {
  return Buffer.from(s.replace(/^(?:0x)?(.*?)(00)*$/, '$1'), 'hex').toString()
}

export interface VersionInfo {
  value: string
  version: string
  time: Date
  canceled: boolean
}

function parseContractVersionInfo (v: any): VersionInfo {
  return {
    value: v.value,
    version: bytes32toString(v.version),
    time: new Date(v.time.toString() * 1000),
    canceled: v.canceled
  }
}

export class VersionOracle {
  oracle: Contract

  constructor (web3provider: any, oracleAddress: PrefixedHexString) {
    const web3 = new Web3(web3provider)
    this.oracle = new web3.eth.Contract(versionOracleAbi as any, oracleAddress)
  }

  /**
   * return the latest "mature" version from teh oracle
   * @param id object id to return a version for
   * @param delayPeriod - don't return entries younger than that (in seconds)
   * @param optInVersion - if set, return this version even if it is young
   * @return version info that include actual version used, its timestamp and value.
   */
  async getVersion (id: string, delayPeriod: number, optInVersion = ''): Promise<VersionInfo> {
    try {
      const ret = await this.oracle.methods
        .getVersion(string32(id), string32(optInVersion), delayPeriod).call()
      return parseContractVersionInfo(ret)
    } catch (e) {
      throw new Error(`getVersion(${id}): ${e.message}`)
    }
  }

  /**
   * return all version history of the given id
   * @param id object id to return version history for
   * @param blockSize - expected max # of entries. if actual count is larger,
   *  it will retry to read with a larger buffer.
   */
  async getAllVersions (id: string, blockSize = 10): Promise<VersionInfo[]> {
    while (true) {
      const { count, ret } = await this.oracle.methods
        .getAllVersions(string32(id), blockSize).call()

      if (count.toString() === blockSize.toString()) {
        blockSize = blockSize * 4
        continue
      }
      return ret.slice(0, count).map(parseContractVersionInfo)
    }
  }
}
