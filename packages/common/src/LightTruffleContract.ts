import { Contract as EthersContract } from 'ethers'

import { JsonFragment, ParamType } from '@ethersproject/abi'
import { JsonRpcProvider, JsonRpcSigner } from '@ethersproject/providers'
import { toBN } from './web3js/Web3JSUtils'

function getComponent (key: string, components: readonly ParamType[]): JsonFragment | undefined {
  // @ts-ignore
  const component = components[key]
  if (component != null) {
    return component
  }
  return components.find(it => it.name === key)
}

function retypeItem (abiOutput: Partial<ParamType>, ret: any): any {
  if (abiOutput.type == null) {
    return ret
  }
  if (abiOutput.type.includes('int')) {
    return toBN(ret.toString())
  } else if (abiOutput.type === 'tuple[]') {
    if (typeof ret.toArray === 'function') { // ethers.js v6 Contract treats all arrays as 'proxy' breaking our 'retype'
      ret = ret.toArray().map((it: any) => {
        if (Object.keys(it.toObject() ?? {})?.[0] === '_') {
          // this appears to be a bug in the Ethers.js - to be investigated
          return it[0]
        }
        return it
      })
    }
    return ret.map((item: any) => retypeItem(
      { ...abiOutput, type: 'tuple' }, item
    ))
  } else if (abiOutput.type.includes('tuple') && abiOutput.components != null) {
    if (typeof ret.toObject === 'function') { // ethers.js v6 Contract
      ret = ret.toObject()
    }
    const keys = Object.keys(ret)
    const newRet: any = {}
    for (let i = 0; i < keys.length; i++) {
      const component = getComponent(keys[i], abiOutput.components)
      if (component == null) {
        newRet[keys[i]] = ret[keys[i]]
        continue
      }
      newRet[keys[i]] = retypeItem(component, ret[keys[i]])
    }
    return newRet
  } else {
    return ret
  }
}

// restore TF type: uint are returned as string in web3, and as BN in TF.
function retype (outputs?: readonly JsonFragment[], ret?: any): any {
  if (outputs?.length === 1) {
    return retypeItem(outputs[0], ret)
  } else {
    const response: { [key in number]: Object } = {}
    outputs?.forEach((value, index) => {
      response[index] = retypeItem(value, ret[index])
    })
    return response
  }
}

export class Contract<T> {
  provider!: JsonRpcProvider

  constructor (
    readonly contractName: string,
    readonly abi: JsonFragment[],
    readonly useEthersV6: boolean
  ) {
  }

  createContract (address: string, signer?: JsonRpcSigner): EthersContract {
    const ethersContract = new EthersContract(address, this.abi)
    return ethersContract.connect(signer ?? this.provider)
  }

  async createContractEthersV6 (address: string, signer?: any): Promise<any> {
    const { Contract: ContractV6 } = await import('ethers-v6/contract')
    const ethersContract = new ContractV6(address, this.abi)
    return ethersContract.connect(signer ?? this.provider)
  }

  // return a contract instance at the given address.
  // UNLIKE TF, we don't do any on-chain check if the contract exist.
  // the application is assumed to call some view function (e.g. version) that implicitly verifies a contract
  // is deployed at that address (and has that view function)
  async at (address: string): Promise<T> {
    // TODO: this is done to force cache the 'from' address to avoid Ethers making a call to 'eth_accounts' every time
    //  the 'getAddress' may throw if the underlying provider does not return addresses.
    let signer: JsonRpcSigner | undefined
    try {
      const noAddressSetSigner: JsonRpcSigner = this.provider.getSigner()
      const signerFromAddress = await noAddressSetSigner.getAddress()
      signer = this.provider.getSigner(signerFromAddress)
    } catch (e: any) {
      // nothing to do here - signer does not have accounts and can only work with ephemeral keys
    }
    let contract: any
    if (this.useEthersV6) {
      contract = await this.createContractEthersV6(address, signer)
    } else {
      contract = this.createContract(address, signer)
    }
    const obj = {
      address,
      contract,
      async getPastEvents (name: string | null, options: any) {
        // @ts-ignore
        return contract.getPastEvents(name, options).map(e => ({
          ...e,
          args: e.returnValues // TODO: web3 uses strings, Truffle uses BN for numbers
        }))
      }
    } as any

    this.abi.forEach(m => {
      const methodName: string = m.name ?? ''
      const nArgs = m.inputs?.length ?? 0
      const isViewFunction = m.stateMutability === 'view' || m.stateMutability === 'pure'
      const useEthersV6 = this.useEthersV6
      obj[methodName] = async function () {
        let args = Array.from(arguments)
        let options = {}
        if (args.length === nArgs + 1 && typeof args[args.length - 1] === 'object') {
          options = args[args.length - 1]
          args = args.slice(0, args.length - 1)
        }

        // TODO: this substitution seems redundant - try removing it!
        let methodCall: any
        if (!isViewFunction) {
          methodCall = contract.functions[methodName]
          return methodCall(...args, options)
        } else {
          if (useEthersV6) {
            methodCall = contract[methodName].staticCall.bind(contract[methodName])
          } else {
            methodCall = contract.callStatic[methodName]
          }
          return methodCall(...args, options)
            .then((res: any) => {
              return retype(m.outputs, res)
            })
        }
        // console.log('===calling', methodName, args)
        // return await methodCall.call(options)
        //   .catch((e: Error) => {
        //     console.log('===ex1', e)
        //     throw e
        //   })
      }
    })
    return obj as unknown as T
  }

  setProvider (provider: JsonRpcProvider, _: unknown): void {
    this.provider = provider
  }
}

export function TruffleContract ({ contractName, abi, useEthersV6 = false }: {
  contractName: string
  abi: any[]
  useEthersV6: boolean
}): any {
  return new Contract(contractName, abi, useEthersV6)
}
