export interface JsonRpcPayload {
  jsonrpc: string
  method: string
  params?: any[]
  id?: string | number
}
