# Sample GSN Paymasters

A GSN paymaster is a contract that actually pays for a relayed request (as the whole point of GSN is that the
calling account require and usually lack eth)


## AcceptEverythingPaymaster

This is the most naive paymaster: it will accept any request by any client.
Obviously, you don't want to deploy that on mainnet, since any client will be able to make any number
of requests to drain it.

## WhitelistPaymaster

This paymaster accepts only request from specific, known addresses.
This way it is protected from anonymous attack, but requires an extra step of whitelisting all
valid addresses.

## HashcashPaymaster

An example paymaster that tries to mitigate abuse by anonymous clients:
It requires the client to perform a "proof of work" that is verified on-chain.
the "approval data" should contain a hash over the caller's address and nonce.

## TokenPaymaster

A paymaster that requires the calling account to have a specific token. The paymaster will pre-charge
the user with the equivalent value of tokens before making the call (and refund it with the excess after
the call)

The client doesn't have to have eth, but has to have an `approval` for the paymaster to pull tokens from its account (for an ETH-less account, this can be done using DAI's `permit` method, or using the next paymaster:)

## ProxyDeployingPaymaster

A specific TokenPaymaster, that can also deploy a proxy account.
Since the paymaster also deploys the proxy, it also makes this proxy "approve" the token, so the paymaster
can charge the account with tokens - even for the proxy creation - and then for all future requests.

<font color="red"><h1>Important notice:</h1></font>

These contracts are provided as an example, and should NOT be deployed as-is into a real network.
None of them have passed a security audit.
Without a careful configuration, a caller can "grief" the paymaster by making many
anonymous calls, and thus drain the paymaster's balance.
