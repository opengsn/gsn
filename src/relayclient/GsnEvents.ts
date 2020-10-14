/**
 * base export class for all events fired by RelayClient.
 * for "progress" report, it is enough to test the base export class only.
 * subclasses contain some extra information about the events.
 * Last event is when we receive response from relayer that event was sent - now we should wait for mining..
 */
const TOTAL_EVENTS = 7
export class GsnEvent {
  total = TOTAL_EVENTS
  constructor (readonly event: string, readonly step: number) {}
}

// initialize client (should be done before all requests. not counted in "total")
export class GsnInitEvent extends GsnEvent {
  constructor () { super('init', 0) }
}

export class GsnRefreshRelaysEvent extends GsnEvent {
  constructor () { super('refresh-relays', 1) }
}

export class GsnDoneRefreshRelaysEvent extends GsnEvent {
  constructor (readonly relaysCount: number) { super('refreshed-relays', 2) }
}

export class GsnNextRelayEvent extends GsnEvent {
  constructor (readonly relayUrl: string) { super('next-relay', 3) }
}

export class GsnSignRequestEvent extends GsnEvent {
  constructor () { super('sign-request', 4) }
}

// before sending the request to the relayer, the client attempt to verify it will succeed.
// validation may fail if the paymaster rejects the request
export class GsnValidateRequestEvent extends GsnEvent {
  constructor () { super('validate-request', 5) }
}

export class GsnSendToRelayerEvent extends GsnEvent {
  constructor (readonly relayUrl: string) { super('send-to-relayer', 6) }
}

export class GsnRelayerResponseEvent extends GsnEvent {
  constructor (readonly success: boolean) { super('relayer-response', 7) }
}
