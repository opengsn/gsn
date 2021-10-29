// import { BaseTransactionReceipt, JsonRpcCallback, RelayProvider } from '../RelayProvider'
// import { Transaction } from '@ethereumjs/tx'
// import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
//
// export class BatchRelayProvider extends RelayProvider {
//   _convertTransactionToRpcSendResponse (no_transaction_here: Transaction, relayRequestId: string, request: JsonRpcPayload): JsonRpcResponse {
//     // difference:
//     // 1. There is no 'transaction', only RelayRequestID.
//   }
//
//   _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
//     // difference:
//     // 1. should not call the original RPC first - the 'txid' here is most likely relayRequestId.
//     // a) [NOT PRIORITY] we can ask Server first for status/txid (servers should not be trusted)
//     // b) poll for RR-ID in the hub events (may be long, heavy and non-deterministic but that is life)
//     // 2. If the 'validUntil' passes and RR-ID does not appear - its not gonna happen, chreate a fake revert receipt
//   }
//
//   _getTranslatedGsnResponseResult (respResult: BaseTransactionReceipt, relayRequestId: string,): BaseTransactionReceipt {
//     // difference:
//     // 1. This receipt will have tons of events; Filter out ones relevant to current relayRequestId
//   }
// }
