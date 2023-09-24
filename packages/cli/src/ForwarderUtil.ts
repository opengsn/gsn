import { Contract, type CallOverrides } from '@ethersproject/contracts'
import { Web3Provider } from '@ethersproject/providers'

import { GsnDomainSeparatorType, GsnRequestType, type LoggerInterface } from '@opengsn/common'
import { type IForwarder } from '@opengsn/contracts/types/ethers-contracts'

interface TruffleContract {
  contract: any
}

// register a forwarder for use with GSN: the request-type and domain separator we're using.
export async function registerForwarderForGsn (
  domainSeparatorName: string,
  forwarderIn: IForwarder | Contract | TruffleContract,
  logger?: LoggerInterface,
  sendOptions: CallOverrides | undefined = undefined
): Promise<void> {
  let forwarder: Contract
  if ((forwarderIn as TruffleContract).contract != null) {
    const provider = new Web3Provider((forwarderIn as any).contract.currentProvider)
    forwarder = new Contract((forwarderIn as any).address, (forwarderIn as any).abi, provider.getSigner())
  } else {
    forwarder = forwarderIn as any
  }

  logger?.info(`Registering request type ${GsnRequestType.typeName} with suffix: ${GsnRequestType.typeSuffix}`)
  const res = await forwarder.registerRequestType(
    GsnRequestType.typeName,
    GsnRequestType.typeSuffix,
    { ...sendOptions }
  )
  logger?.debug(`Transaction broadcast: ${res?.hash as string}`)

  logger?.info(`Registering domain separator ${domainSeparatorName} with version: ${GsnDomainSeparatorType.version}`)
  await forwarder.registerDomainSeparator(domainSeparatorName, GsnDomainSeparatorType.version, { ...sendOptions })
}
