import { GsnDomainSeparatorType, GsnRequestType } from './TypedRequestData'
import { IForwarderInstance } from '../../../types/truffle-contracts'
import { Contract } from 'web3-eth-contract'

// register a forwarder for use with GSN: the request-type and domain separator we're using.
export async function registerForwarderForGsn (forwarderTruffleOrWeb3: IForwarderInstance|Contract, sendOptions: any = undefined): Promise<void> {
  let forwarder: Contract
  if ((forwarderTruffleOrWeb3 as any).contract != null) {
    forwarder = (forwarderTruffleOrWeb3 as any).contract
    // truffle-contract carries default options (e.g. from) in the object.
    // @ts-ignore
    sendOptions = { ...forwarderTruffleOrWeb3.constructor.defaults(), ...sendOptions }
  } else {
    forwarder = forwarderTruffleOrWeb3 as any
  }

  await forwarder.methods.registerRequestType(
    GsnRequestType.typeName,
    GsnRequestType.typeSuffix
  ).send(sendOptions)

  await forwarder.methods.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version).send(sendOptions)
}
