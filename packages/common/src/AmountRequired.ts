import BN from 'bn.js'
import { toBN } from 'web3-utils'

import { boolString, formatTokenAmount } from './Utils'
import { LoggerInterface } from './LoggerInterface'
import { ERC20TokenMetadata } from './ContractInteractor'

const ether = {
  tokenName: 'Ether',
  tokenSymbol: 'ETH',
  tokenDecimals: toBN(18)
}

export class AmountRequired {
  logger: LoggerInterface
  _name: string
  _currentValue = toBN(0)
  _requiredValue = toBN(0)
  _listener?: () => void
  _tokenMetadata: ERC20TokenMetadata

  constructor (name: string, requiredValue: BN, logger: LoggerInterface, listener?: () => void, tokenMetadata: ERC20TokenMetadata = ether) {
    this.logger = logger
    this._name = name
    this._tokenMetadata = tokenMetadata
    this._requiredValue = requiredValue
    this._listener = listener
  }

  get currentValue (): BN {
    return this._currentValue
  }

  set currentValue (newValue: BN) {
    const didChange = !this._currentValue.eq(newValue)
    const wasSatisfied = this.isSatisfied
    this._currentValue = newValue
    if (didChange) {
      this._onChange(wasSatisfied)
    }
  }

  get requiredValue (): BN {
    return this._requiredValue
  }

  set requiredValue (newValue: BN) {
    const didChange = !this._requiredValue.eq(newValue)
    const wasSatisfied = this.isSatisfied
    this._requiredValue = newValue
    if (didChange) {
      this._onChange(wasSatisfied)
    }
  }

  _onChange (wasSatisfied: boolean): void {
    let changeString
    if (wasSatisfied === this.isSatisfied) {
      changeString = `still${this.isSatisfied ? '' : ' not'}`
    } else if (this.isSatisfied) {
      changeString = 'now'
    } else {
      changeString = 'no longer'
    }
    const message = `${this._name} requirement is ${changeString} satisfied\n${this.description}`
    this.logger.warn(message)
    if (this._listener != null) {
      this._listener()
    }
  }

  get isSatisfied (): boolean {
    return this._currentValue.gte(this._requiredValue)
  }

  get description (): string {
    const status = boolString(this.isSatisfied)
    const actual: string = formatTokenAmount(this._currentValue, this._tokenMetadata.tokenDecimals, this._tokenMetadata.tokenSymbol)
    const required: string = formatTokenAmount(this._requiredValue, this._tokenMetadata.tokenDecimals, this._tokenMetadata.tokenSymbol)
    return `${this._name.padEnd(14)} | ${status.padEnd(14)} | actual: ${actual.padStart(16)} | required: ${required.padStart(16)}`
  }
}
