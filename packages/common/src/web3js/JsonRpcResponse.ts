// export interface JsonRpcPayload {
//   jsonrpc: string;
//   method: string;
//   params?: any[];
//   id?: string | number;
// }

export interface JsonRpcResponse {
  jsonrpc: string
  id: string | number
  result?: any
  error?: {
    readonly code?: number
    readonly data?: unknown
    readonly message: string
  }
}
