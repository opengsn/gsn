import { JsonRpcResponse } from 'web3-core-helpers'

export type SendCallback = (error: (Error | null), result?: JsonRpcResponse) => void
