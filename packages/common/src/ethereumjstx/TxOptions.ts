// Copied from "@ethereumjs/tx/dist/types.d.ts" to remove it as dependency
// TODO: stop using 'TxOptions' in server as well
import Common from '@ethereumjs/common'

export interface TxOptions {
  common?: Common
  freeze?: boolean
}
