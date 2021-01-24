import Web3 from 'web3'
import { AbiItem, AbiOutput, toBN } from 'web3-utils'
import { Web3ProviderBaseInterface } from './types/Aliases'

function retypeItem (abiOutput: AbiOutput, ret: any): any {
  if (abiOutput.type.includes('int')) {
    return toBN(ret)
  } else {
    return ret
  }
}

// restore TF type: uint are returned as string in web3, and as BN in TF.
function retype (outputs?: AbiOutput[], ret?: any): any {
  if (outputs?.length === 1) {
    return retypeItem(outputs[0], ret)
  } else {
    // seems like structure return values in truffle are left as strings,
    return ret
  }
}

export class Contract<T> {
  web3!: Web3

  constructor (readonly contractName: string, readonly abi: AbiItem[]) {
  }

  createContract (address: string): any {
    return new this.web3.eth.Contract(this.abi, address)
  }

  // return a contract instance at the given address.
  // UNLIKE TF, we don't do any on-chain check if the contract exist.
  // the application is assumed to call some view function (e.g. version) that implicitly verifies a contract
  // is deployed at that address (and has that view function)
  async at (address: string): Promise<T> {
    const contract = this.createContract(address)
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
      obj[methodName] = async function () {
        let args = Array.from(arguments)
        let options
        if (args.length === nArgs + 1 && typeof args[args.length - 1] === 'object') {
          options = args[args.length - 1]
          args = args.slice(0, args.length - 1)
        }

        const methodCall = contract.methods[methodName].apply(contract.methods, args)
        if (!isViewFunction) {
          return methodCall.send(options)
        } else {
          return methodCall.call(options)
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

  setProvider (provider: Web3ProviderBaseInterface, _: unknown): void {
    this.web3 = new Web3(provider as any)
  }
}

export function TruffleContract ({ contractName, abi }: { contractName: string, abi: any[] }): any {
  return new Contract(contractName, abi)
}
