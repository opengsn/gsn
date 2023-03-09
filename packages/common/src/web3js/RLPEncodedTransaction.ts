export interface RLPEncodedTransaction {
  raw: string
  tx: {
    nonce: string
    gasPrice: string
    gas: string
    to: string
    value: string
    input: string
    r: string
    s: string
    v: string
    hash: string
  }
}
