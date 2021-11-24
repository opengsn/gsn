export interface DebugTransaction {
  gas: number
  failed: boolean
  returnValue: string
  structLogs: DebugOpCode[]
}

export interface DebugOpCode {
  pc: number
  op: string
  gas: number
  gasCost: number
  depth: number
}

export async function debugTransaction (provider: any, hash: string): Promise<DebugTransaction> {
  const traceOptions = {
    disableMemory: true,
    disableStack: true,
    disableStorage: true
  }
  return await new Promise((resolve, reject) => provider.send({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'debug_traceTransaction',
    params: [hash, traceOptions]
  }, (error: any, result: any) => {
    const err = error ?? result.error
    if (err != null) {
      reject(err)
    } else {
      resolve(result.result)
    }
  }))
}

//output SSTORE and SLOAD opcodes from a transaction.
export async function txStorageOpcodes (provider: any, hash: string): Promise<any> {
  const ret = await debugTransaction(provider, hash)
  const opcodes: { [key: string]: number } = {}
  let sstore = 0
  let sload = 0
  ret.structLogs
    .filter(log => ['SSTORE', 'SLOAD'].includes(log.op))
    .forEach(log => {
      const key = `${log.op}-${log.gasCost}`
      if (log.op === 'SSTORE') {
        sstore += log.gasCost
      } else {
        sload += log.gasCost
      }
      opcodes[key] = (opcodes[key] ?? 0) + 1
    })
  opcodes.sload_total = sload
  opcodes.sstore_total = sstore
  return opcodes
}
