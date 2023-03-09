import { Contract } from 'web3-eth-contract'
import { GsnDomainSeparatorType, GsnRequestType, LoggerInterface } from '@opengsn/common'
import { IForwarderInstance } from '@opengsn/contracts/types/truffle-contracts'

// register a forwarder for use with GSN: the request-type and domain separator we're using.
export async function registerForwarderForGsn (domainSeparatorName: string, forwarderTruffleOrWeb3: IForwarderInstance | Contract, logger?: LoggerInterface, sendOptions: any = undefined): Promise<void> {
  let options
  let forwarder: Contract
  if ((forwarderTruffleOrWeb3 as any).contract != null) {
    forwarder = (forwarderTruffleOrWeb3 as any).contract
    // truffle-contract carries default options (e.g. from) in the object.
    // @ts-ignore
    options = { ...forwarderTruffleOrWeb3.constructor.defaults(), ...sendOptions }
  } else {
    options = { ...sendOptions }
    forwarder = forwarderTruffleOrWeb3 as any
  }

  function logTx (p: any): any {
    p.on('transactionHash', function (hash: string) {
      logger?.debug(`Transaction broadcast: ${hash}`)
    })
    p.on('error', function (err: Error) {
      logger?.debug(`tx error: ${err.message}`)
    })
    return p
  }

  logger?.info(`Registering request type ${GsnRequestType.typeName} with suffix: ${GsnRequestType.typeSuffix}`)
  await logTx(forwarder.methods.registerRequestType(
    GsnRequestType.typeName,
    GsnRequestType.typeSuffix
  ).send(options))

  logger?.info(`Registering domain separator ${domainSeparatorName} with version: ${GsnDomainSeparatorType.version}`)
  await logTx(forwarder.methods.registerDomainSeparator(domainSeparatorName, GsnDomainSeparatorType.version).send(options))
}
