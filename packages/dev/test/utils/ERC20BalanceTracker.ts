import BN from 'bn.js'

import { Address } from '@opengsn/common'

const TestToken = artifacts.require('TestToken')

class ERC20BalanceTracker {
  private readonly token: Address
  private readonly account: Address
  private prev?: BN

  constructor (tok: Address, acc: Address) {
    this.token = tok
    this.account = acc
  }

  async delta (): Promise<BN> {
    if (this.prev == null) {
      throw new Error('prev is null')
    }
    const current = await this.balanceCurrentErc20()
    const delta = current.sub(this.prev)
    this.prev = current

    return new BN(delta)
  }

  async get (): Promise<BN> {
    this.prev = await this.balanceCurrentErc20()
    return new BN(this.prev)
  }

  async balanceCurrentErc20 (): Promise<BN> {
    const token = await TestToken.at(this.token)
    return await token.balanceOf(this.account)
  }
}

export async function balanceTrackerErc20 (token: Address, owner: Address): Promise<ERC20BalanceTracker> {
  const tracker = new ERC20BalanceTracker(token, owner)
  await tracker.get()
  return tracker
}
