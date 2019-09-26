# The GSN Protocol

This document comes to describe the protocol between the client application and the relay,
 for the purpose of sending a transaction to the blockchain.

Note that most of the client data is checked not by the relay but on-chain by the `RelayHub` contract.<br/> 
The formal specification of the protocol is defined by [EIP1813](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1613.md)

## Versioning

The RelayHub contract version is currently `1.0.0` (as returned by the `RelayHub.version()` method)

The current RelayClient and RelayServer protocol (described in this document) is `0.4.1`

The client should validate the relay supports this version when processing the `/getaddr` response (see below) 

Version codes folow [SEMVER](https://semver.org)

## Terminology

* **client** - the calling client. identified by an address (And has the corresponding private-key or method for signing)
* **relay** or **relayer** - the server that creates the actual ethereum transaction. 
* **target** or **target contract** - the contract that receive the call and will pay for the transaction.
* **RelayHub** - the on-chain RelayHub contract.
* **relayed call** - the call to be sent over the blockchain. This is a signed request, (by the client) 
    but it is not an ethereum transaction: it contains relaying-specific fields. 

## Overview

At a high-level the client perform the following steps:

1. [Create list of Potential Relays](#create-list)
2. [Select a relay](#select-relay)
3. [Create a request](#create-request)
4. [Send Request to the Relay.](#send-request)
5. [Validate Response.](#validate-response)
6. [ Handle Relay Error Responses.](#relay-error)
7. [Process Trasnaction-receipt](#process-tx-rcpt)

A relay perform the following steps:

1. [Relay setup and background processes](#relay-setup)
2. [Handling Incoming Request](#relay-process)
3. [Handling stuck transactions](#relay-underpriced-tx)

## Client Detailed Request Flow
<a name="create-list"></a> 
### 1. Create a List of Potential Relays

* First, the client MUST get the RelayHub used by the target contract, by calling `target.getHubAddr()`<br/>
    **NOTE**: it is important that the client **doesn't assume** the target uses the global RelayHub address: If/when the RelayHub is updated, its the target contract's responsibility to update its hub link.
* Next, the client SHOULD filter for recent `RelayAdded` and `RelayRemoved` events sent by the RelayHub.
  Since a relay is required to send such event every 6000 blocks (roughly 24hours), the client should look at most at the latest 6000 blocks.     
* For each relay, look for the latest `RelayAdded` event. Also, all Relays with `RelayRemoved` event should be removed from the list.
* Now the client should filter out relays that it doesn't care about. e.g.: 
  Ignore relays with stake time or stake delay below a given threshold. 
* Sort the relays in the preferred order. e.g.: prefer relays with lower transaction fee, and also depend on the [Relay Reputation](#relay-reputation)
* Dynamic relay selection: before making the call, the client SHOULD "ping" the relay (see below)
* For each relay, the client keeps the relay `address` and `url`  

<a name="select-relay"></a>
###  2. Select a Relay

* For each potential relay, the client "pings" the relay by sending a `/getaddr` request.
* Validate the relay is valid (contains `valid:true`)
* Validate the relay supports this protocol: `version:1.0.x`
* Validate the `MinGasPrice`: The relay MAY reject request with lower gas-price, so the client 
    SHOULD skip requesting the relay if the relay requires higher gas-price.
* The client SHOULD ping few relays, but not too much: e.g. default client pings 3 relays, and use the first valid one. 
    Only if none of the first 3 relays answers, it will select the next 3 relays from the list  

<a name="create-request"></a>    
### 3. Create a Request

* The client should create and sign a relay request, which MUST contain the following fields:
  -  `from`: the client's address
  -  `to`: the target contract's address
  - `encodedFunction` - the function to call on the **target** contract.
  -  `relayFee`: the fee the client would pay for the relay. The fee is precent above the real transaction price, so "70" means the actual fee the client will pay would be: `usedGas*(100+relayFee)/100`
  -  `gasPrice`: the **Minimum** gas price for the request. The relay MAY use higher gas-price, but will only get 
    compensated for this advertised gas-price.
  -  `gasLimit`: the **Minimum** gas-limit available for the **encodedFunction**. Note that the actual request will have higher gas-limit,
    to compensate for the pre- and post- relay calls, but these are limited by a total of 250,000 gas.<br/>
  -  `RecipientNonce`: the client should put `relayHub.getNonce(from)` in this field.<br/>
        **NOTE**: this is a naming bug: its a `senderNonce`, not `recpientNonce`...
  -  `RelayHubAddress`: the address of the relay hub.
  - `relay-address`: this is not sent over the protocol, but it is added to the hash to create the signature
  -  `signature`: a signature over the above parameters (see "Calculating signature" below)
  -  `RelayMaxNonce`: the maximum `nonce` value of the relay itself. The client should read the `getTransactionCount(relayAddress)`, and add a "gap". a "gap" of zero means the clients
    will only accept the transction to be the very next tx of the relay. a larger gap means the client would accept its transction to be queued.<br/>
    Note that this parameter is NOT signed (the relay can't be penalized for putting higher nonce). But if the client 
    sees the relay's returned transaction contains a higher nonce, it would simply re-send through another relay, 
    and this transaction (that will getsent later) will be rejected - and the relay would pay for this rejection.    
  -  `approvalData`: This is an extra data that MAY be used by custom clients and target contracts. It is not signed 
    by the signature, and by default its empty.
        
#### Calculating signature

* concatenate the byte values of the fields: from, to, encodedFunction, relayFee, gasPrice, gasLimit, nonce, RelayHubAddress, relayAddress
  - addresses are packed as 40 bytes, uint values as 32 bytes. the encodedFunction is encoded as a byte array
* add a 4-byte prefix `"rlx:"`
* create a keccak256 hash of the above string
* create ethereum hash of the above:
  - add a prefix `"\x19Ethereum Signed Message:\n32"`
  - create a keccak256 hash.
* sign the generated hash with the `from`'s field private-key
* return the 65-byte (r,s,v) signature

<a name="send-request"></a>
### 4. Send Request to the Relay. 
* Before sending the request, the client MAY validate if the target would accept it, by calling the `canRelay()`
    method of the target contract.<br/>
    This way, the client doesn't have to trust the relay as to the result of the on-chain contract.<br/>
    Note that the relay itself will call the `canRelay` method too, before sending the request on-chain.
* In case the above `canRelay` call fails, it is most likely that no other relay would accept that call 
    (e.g. the target contract doesn't accept request from this client) (see [edge-case here](#relay-specific-target))
         
* The client sends a POST request to `/relay` with the above JSON request, and waits for a response. The relay should
    creates a signed transaction, and returns it to the client.<br>
    In case the relay doesn't answer after a reasonable network-delay time (e.g. 10 seconds), the client MAY continue 
    and send a request to another relay. (use with care, as such situation makes the client appear to "attack" the relay)

<a name="validate-response"></a>
### 5. Validate Relay Response
A response from the relay is transaction JSON in the format:
```json
{ none: '0x1',
  gasPrice: '0x59682f000',
  gas: '0x24a70c',
  to: '0x123456789abcdef0123456789abcdef012345678', 
  value: '0x0',
  input: '0x.....',
  v: '0x1b',
  r: '0x779c6b594da215d65b2fe2325fa9e6f1c7d801c5162c92132e9249ae6676520b',
  s: '0x18829cd1c02f47d9981fa4c777cf647bcae1bfa84475276e6ec7e683451ae264',
  hash: '0xc5b4fd72a73aa050ec7112e31a90477e5375611ee12665753fffeffc62166a95'
}
```

or an error: 
```json
{ error: "..." }
```

When the response is received, the client should validate it, to make sure its transaction was properly sent to 
 the RelayHub:
* Decode the transaction to make sure its a valid ethereum transaction, signed by the relay.
* Check that the relay has enough balance to pay for it.
* The relay's nonce on the transaction meets the expectation (that is, its not too far from current relay's nonce)
* The client MAY put the transaction on-chain. In that case, it should ignore "repeated transaction" error (since the 
  relay itself also should put it on-chain)
* The client MAY send the request to a randomly chosen other relay through the `/validate` URL, instead of performing 
    the validation steps below.
* The client should wait for the relay's `nonce` to get incremented to the transaction nonce.
* Then it should validate that the on-chain transaction with that nonce is indeed the transaction returned to the client
    (note that it may have different (higher) gas-price, but otherwise should be the same)
* If the transaction with that nonce is different, it MAY call `RelayHub.penalizeRepeatedNonce()` to slash the relay's
    stake (and gain half of it)
    
<a name="relay-error"></a>    
### 6. Handle Relay Error Responses.    
* In case of error, the relay MAY return an error in the format `{ "error": "<message>" }`
* In any such case, the client should continue to send the transaction to the next available relay.

<a name="process-tx-rcpt"></a>
### 7. Process Trasnaction Receipt
* Wait until the trasnaction is mined.<br/>
    Since the relay MAY mine a transaction with different transaction fee, the client
    should NOT wait by the transaction-hash, but instead wait either for the relay's `nonce` to match the returned 
    transaction nonce, or for a `TransactionRelayed`/`CanRelayFailed` event for this relay/sender/receipient.
* Once the transaction is mined, the client SHOULD check the resulting event:
  - If no event was triggered, then the transaction was reverted (on the relay's expense...). The client MAY need 
    to re-send its request, probably through another relay.
  - `CanRelayFailed`: This should be reported as "reverted" to the calling client. However, the revert reason is not
    the executed method, but rather the target contract failed to accept the request on-chain - even though the same 
    `canRelay()` returned a valid response when called as a view function.
  - `TransactionRelayed`: check the `status` member. if its OK, then the transaction had succeeded. otherwise, the 
    original transaction had reverted.
    - **RelayedCallFailed**: this value indicates that the relayed transaction was reverted.
    - **PreRelayedFailed**: the target's `preRelayedCall` had reverted. the relayed function was not triggered at all.
    - **PostRelayedFailed**: the target's `postRelayedCall` had reverted. as a result, the relayed function was also reverted.
    - **RecipientBalanceChanged**: the target's balance was changed. As this might cause relay fee problems, the transaction was reverted. 

## Relay Process

<a href name="relay-setup"></a>
### 1. Relay setup and background processes

* The relay process SHOULD wait until its owner calls `RelayHub.stake()` on its behalf, and sends some eth to the 
    relay's address.
* Periodically in the background, the relay should check that it's balance is enough to process request.
* determine an acceptable gasPrice (e.g. by calling `getGasPrice()`)
* In case the relay can't process requests, it should return `valid:false` to `/getaddr` requests.
* periodically (every 6000 blocks) the relay should send a `RelayHub.register()` request, to refresh its status
    
<a href name="relay-process"></a>
### 2. Handling Incoming Request
* validate the target has enough balance to pay for the transaction.
* validate the sender's signature.
* validate the gasPrice 
* call `RelayHub.canRelay`, to validate the recipient will accept this call.
* create a signed ethereum transaction.
* send the transaction on-chain
* return the signed transaction to the caller.

<a href name="relay-underpriced-tx"></a>
### 3. Handling stuck transactions
* It is possible that a relay would accept a transaction at a given gas price, but due to fluctuation, that transaction 
    doesn't get mined.
* To handle such cases, the relay should maintain a list of un-mined transaction, and raise their gas-price accordingly    


## Special cases

<a name="relay-reputation"></a>
### Relay Reputation

The client should maintain a list of relays that failed a request (that is, a relay answered "valid" in its `/getaddr` 
 request, but later returned an "error" when calling the `/relay` request) 

This way, a relay(s) can't DDoS a client - as long as there's at least one valid relay in the network.

<a name="#relay-specific-target"></a>
### Relay-Specific Target
In most cases, a target contract will ignore the "relay" field of the request in its `canRelay`, as it should be neutral to which relay
passed the call.
It is possible, however, that a target will accept request through a specific relay(s). In that case, `canRelay` would
fail if a call attempt is made through another relay.

In such a case, the client should be configured such that it uses only relays that are capable to pass the request.
