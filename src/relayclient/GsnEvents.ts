/**
 * base export class for all events fired by RelayClient.
 * for "progress" report, it is enough to test the base export class only.
 * subclasses contain some extra information about the events.
 */
const TOTAL_EVENTS = 8
export class GsnEvent {
  total = TOTAL_EVENTS
  constructor (readonly event: string, readonly step: number) {}
}

// initialize client (takes time only on first request)
export class GsnInitEvent extends GsnEvent {
  constructor () { super('init', 1) }
}

export class GsnRefreshRelaysEvent extends GsnEvent {
  constructor () { super('refresh-relays', 2) }
}

export class GsnDoneRefreshRelaysEvent extends GsnEvent {
  constructor (readonly relaysCount: number) { super('refreshed-relays', 3) }
}

export class GsnNextRelayEvent extends GsnEvent {
  constructor (readonly relayUrl: string) { super('next-relay', 4) }
}

export class GsnSignRequestEvent extends GsnEvent {
  constructor () { super('sign-request', 5) }
}

// before sending the request to the relayer, the client attempt to verify it will succeed.
// validation may fail if the paymaster rejects the request
export class GsnValidateRequestEvent extends GsnEvent {
  constructor () { super('validate-request', 6) }
}

export class GsnSendToRelayerEvent extends GsnEvent {
  constructor (readonly relayUrl: string) { super('send-to-relayer', 7) }
}

export class GsnRelayerResponseEvent extends GsnEvent {
  constructor (readonly success: boolean) { super('relayer-response', 8) }
}
