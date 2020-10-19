import { GsnDomainSeparatorType, GsnRequestType } from './TypedRequestData'
import { IForwarderInstance } from '../../../types/truffle-contracts'
import { Contract } from 'web3-eth-contract'
import log from 'loglevel'

// register a forwarder for use with GSN: the request-type and domain separator we're using.
export async function registerForwarderForGsn (forwarderTruffleOrWeb3: IForwarderInstance|Contract, sendOptions: any = undefined): Promise<void> {
  let options = sendOptions
  let forwarder: Contract
  if ((forwarderTruffleOrWeb3 as any).contract != null) {
    forwarder = (forwarderTruffleOrWeb3 as any).contract
    // truffle-contract carries default options (e.g. from) in the object.
    // @ts-ignore
    options = { ...forwarderTruffleOrWeb3.constructor.defaults(), ...sendOptions }
  } else {
    options = sendOptions
    forwarder = forwarderTruffleOrWeb3 as any
  }

  function logTx (p: any): any {
    p.on('transactionHash', function (hash: string) {
      log.debug(`Transaction broadcast: ${hash}`)
    })
    p.on('error', function (err: Error) {
      log.debug(`tx error: ${err.message}`)
    })
    return p
  }
  await logTx(forwarder.methods.registerRequestType(
    GsnRequestType.typeName,
    GsnRequestType.typeSuffix
  ).send(options))

  await logTx(forwarder.methods.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version).send(options))
}
