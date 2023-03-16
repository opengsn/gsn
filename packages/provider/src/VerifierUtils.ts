import { PrefixedHexString } from 'ethereumjs-util'
import { ApprovalDataCallback, HttpWrapper, LoggerInterface, RelayRequest, appendSlashTrim } from '@opengsn/common'

// TODO: replace with production URL before release
export const DEFAULT_VERIFIER_SERVER_URL = 'https://staging-api.opengsn.org'
export const DEFAULT_VERIFIER_SERVER_APPROVAL_DATA_LENGTH = 65

export interface ApprovalRequest {
  apiKey: string
  chainId: number
  domainSeparatorName: string
  relayRequest: RelayRequest
  relayRequestId: string
}

export function createVerifierApprovalDataCallback (
  httpWrapper: HttpWrapper,
  logger: LoggerInterface,
  domainSeparatorName: string,
  chainId: number,
  apiKey: string,
  verifierUrl: string
): ApprovalDataCallback {
  return async function defaultVerifierApprovalDataCallback (
    relayRequest: RelayRequest,
    relayRequestId: PrefixedHexString
  ) {
    const approvalRequest: ApprovalRequest = {
      apiKey,
      chainId,
      domainSeparatorName,
      relayRequest,
      relayRequestId
    }
    const signRelayRequestResponse = await httpWrapper.sendPromise(new URL('signRelayRequest', appendSlashTrim(verifierUrl)), approvalRequest)
    logger.info(`signRelayRequest response: ${JSON.stringify(signRelayRequestResponse)}`)
    return signRelayRequestResponse.signature
  }
}
